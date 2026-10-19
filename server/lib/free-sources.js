'use strict';
// Free subscription aggregation: fetch public free-node sources, merge and
// de-duplicate them, test liveness, and materialize the survivors as the
// free-aggregate profile.
//
// Liveness is tested in two stages, because a TCP connect is NOT proof that a
// free node works:
//   1. TCP probe (fast, cheap) - drops hosts that are offline or have closed
//      ports. On its own it is misleading: an expired vmess/vless/ss key, a
//      blocked IP or a fake port still accepts TCP and then fails the real
//      handshake. Measured on a live sample, TCP-alive nodes scored 0/12 for
//      vmess, 0/12 for vless and 0/7 for ss, while plain http/socks5 (which
//      need no handshake) scored 7/12 and 2/2.
//   2. Real probe through a throwaway mihomo instance that loads the
//      candidates and asks the core to actually connect through each one.
//      This is the only honest test, and it runs on its own ports and a fresh
//      temporary data dir so the user's running core is never touched.
//
// The probe target must be a domain that is actually blocked domestically.
// www.gstatic.com is reachable from CN, so testing against it marks nodes
// "alive" that cannot proxy a real blocked site (measured: a CN node passed
// gstatic at 1195ms and then failed www.google.com with ECONNRESET).
const fs = require('fs');
const fsp = fs.promises;
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');
const { DATA_DIR, PROFILES_DIR, MIHOMO_RUN } = require('../constants');
const { writeFileAtomic } = require('./atomic');
const { updateMeta } = require('./meta');
const { convertSubscription } = require('./subscription-convert');
const { loadIntranet, domainDirectRules, privateDirectRules, fakeIpFilterEntries } = require('./intranet');

const FREE_AGGREGATE_FILE = 'free-aggregate.yaml';
const SOURCES_FILE = 'free-sources.json';
const GH_PROXY_PREFIX = 'https://gh-proxy.com/';
const FETCH_TIMEOUT_MS = 15000;
const TCP_TIMEOUT_MS = 2000;
const TCP_CONCURRENCY = 64;
const CORE_TIMEOUT_MS = 5000;
const CORE_CONCURRENCY = 32;
const CORE_START_TIMEOUT_MS = 20000;
const CORE_TEST_URL = 'https://www.google.com/generate_204';
// Free aggregators list thousands of nodes; cap what each source contributes
// and how many survivors end up in the profile so the sweep stays bounded and
// the resulting config stays usable.
const MAX_PER_SOURCE = 400;
const MAX_KEEP = 300;
const DEFAULT_INTERVAL_MIN = 120;

// Public aggregate sources that expose a raw subscription file. Any of them
// can disappear at any time - a failed source is skipped, never fatal.
const DEFAULT_SOURCES = [
    { name: 'anaer/Sub', url: 'https://raw.githubusercontent.com/anaer/Sub/main/clash.yaml' },
    { name: 'ermaozi/get_subscribe', url: 'https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/clash.yml' },
    { name: 'peasoft/NoMoreWalls', url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt' },
    { name: 'free18/v2ray', url: 'https://raw.githubusercontent.com/free18/v2ray/main/c.yaml' },
    { name: 'ripaojiedian/freenode', url: 'https://raw.githubusercontent.com/ripaojiedian/freenode/main/sub' }
];

/** Read data/free-sources.json, seeding it with the defaults on first run. */
async function loadFreeSources(filePath = path.join(DATA_DIR, SOURCES_FILE)) {
    try {
        const parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
        if (Array.isArray(parsed) && parsed.length) {
            return parsed.filter((s) => s && s.name && s.url);
        }
    } catch {
        // Missing or broken file: fall through to the defaults.
    }
    await writeFileAtomic(filePath, JSON.stringify(DEFAULT_SOURCES, null, 2));
    return DEFAULT_SOURCES;
}

/** Fetch a source body; raw.githubusercontent URLs fall back to a mirror. */
async function fetchSourceText(url) {
    const attempt = async (target) => {
        const resp = await fetch(target, {
            headers: { 'User-Agent': 'clash.meta', 'Accept': '*/*' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            redirect: 'follow'
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        if (/<html|<!DOCTYPE/i.test(text)) throw new Error('got an HTML page');
        return text;
    };
    try {
        return await attempt(url);
    } catch (err) {
        if (url.startsWith('https://raw.githubusercontent.com/')) return attempt(GH_PROXY_PREFIX + url);
        throw err;
    }
}

/** Pull the proxies array out of either a share-link list or a Clash YAML. */
function extractProxies(text) {
    const converted = convertSubscription(text);
    if (converted.alreadyYaml) {
        try {
            const parsed = YAML.parse(text);
            return Array.isArray(parsed && parsed.proxies) ? parsed.proxies.filter(Boolean) : [];
        } catch {
            return [];
        }
    }
    return converted.proxies;
}

/**
 * Merge per-source proxy lists: drop entries without server/port, collapse
 * identical endpoints across sources, and keep names unique (mihomo requires
 * unique proxy names) by suffixing collisions.
 */
function mergeProxies(groups, perSourceCap = MAX_PER_SOURCE) {
    const seenAddr = new Set();
    const seenName = new Set();
    const out = [];
    for (const group of groups) {
        if (!Array.isArray(group)) continue;
        let taken = 0;
        for (const p of group) {
            if (taken >= perSourceCap) break;
            if (!p || !p.name || !p.server || !p.port) continue;
            const key = `${p.type}|${p.server}|${p.port}`;
            if (seenAddr.has(key)) continue;
            seenAddr.add(key);
            let name = String(p.name);
            let i = 2;
            while (seenName.has(name)) name = `${p.name} #${i++}`;
            seenName.add(name);
            out.push({ ...p, name });
            taken++;
        }
    }
    return out;
}

/**
 * Wrap the aggregate as a bootable config whose default route is the url-test
 * group, not DIRECT. A select group that starts at DIRECT silently sends every
 * blocked site straight out, which looks exactly like "none of the nodes
 * work"; the user can still pick DIRECT or any single node in the UI.
 */
function wrapAggregate(proxies, intranet = { domainRules: [], privateRules: [], fakeIpFilter: [] }) {
    const names = proxies.map((p) => p.name);
    const doc = {
        proxies,
        'proxy-groups': [
            { name: 'Proxy', type: 'select', proxies: ['Auto', 'DIRECT', ...names] },
            {
                name: 'Auto',
                type: 'url-test',
                proxies: names.length ? names : ['DIRECT'],
                url: CORE_TEST_URL,
                // Free nodes die often, so failover speed matters more than a
                // quiet background: test every minute, and keep testing while
                // idle (lazy:true, the default, skips health checks when there
                // is no traffic, so a node that died overnight would only be
                // noticed after the user starts browsing again).
                interval: 60,
                lazy: false
            }
        ],
        // Intranet first: these must win over MATCH, or corporate hosts that
        // resolve to private IPs get proxied and become unreachable.
        rules: [
            ...intranet.domainRules,
            'GEOIP,CN,DIRECT,no-resolve',
            ...intranet.privateRules,
            'MATCH,Proxy'
        ],
        dns: { 'fake-ip-filter': intranet.fakeIpFilter }
    };
    return YAML.stringify(doc, { lineWidth: -1, noRefs: true });
}

/** Resolve true when a TCP connection to the node can be established. */
function tcpProbe(proxy, timeoutMs = TCP_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: proxy.server, port: Number(proxy.port) });
        const done = (ok) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

/** Probe in bounded batches; returns the surviving proxies. */
async function probeAll(proxies, { concurrency = TCP_CONCURRENCY, timeoutMs = TCP_TIMEOUT_MS } = {}) {
    const alive = [];
    for (let i = 0; i < proxies.length; i += concurrency) {
        const batch = proxies.slice(i, i + concurrency);
        const results = await Promise.all(batch.map((p) => tcpProbe(p, timeoutMs)));
        batch.forEach((p, idx) => {
            if (results[idx]) alive.push(p);
        });
    }
    return alive;
}

/** Grab an ephemeral local port for the throwaway core. */
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
    });
}

/** The minimal config the throwaway core loads while probing. */
function buildProbeConfig(proxies, apiPort, mixedPort) {
    return YAML.stringify(
        {
            'mixed-port': mixedPort,
            'allow-lan': false,
            mode: 'rule',
            'log-level': 'silent',
            'external-controller': `127.0.0.1:${apiPort}`,
            proxies,
            'proxy-groups': [{ name: 'Probe', type: 'select', proxies: proxies.map((p) => p.name) }],
            rules: ['MATCH,DIRECT']
        },
        { lineWidth: -1, noRefs: true }
    );
}

async function waitForCore(apiPort, deadlineMs, isDead) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
        if (isDead()) return false;
        try {
            const resp = await fetch(`http://127.0.0.1:${apiPort}/version`, { signal: AbortSignal.timeout(2000) });
            if (resp.ok) return true;
        } catch {
            // Not up yet.
        }
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

/** Delay in ms through the throwaway core, or 0 when it does not work. */
async function probeThroughCore(apiPort, name, timeoutMs) {
    const url = `http://127.0.0.1:${apiPort}/proxies/${encodeURIComponent(name)}/delay?timeout=${timeoutMs}&url=${encodeURIComponent(CORE_TEST_URL)}`;
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs + 3000) });
        if (!resp.ok) return 0;
        const body = await resp.json();
        return Number.isFinite(body.delay) && body.delay > 0 ? body.delay : 0;
    } catch {
        return 0;
    }
}

/**
 * Fastest first. url-test picks by measured delay once its first health check
 * lands, but before that it falls back to list order - so a verified-fast node
 * should be at the front rather than whatever the sources happened to list.
 */
function orderByDelay(entries) {
    return entries.slice().sort((a, b) => a.delay - b.delay).map((e) => e.proxy);
}

/** Remove a directory, retrying briefly: Windows keeps handles after a kill. */
async function removeDirWithRetry(dir, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
        try {
            await fsp.rm(dir, { recursive: true, force: true });
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 300));
        }
    }
}

/**
 * Real liveness test through a throwaway mihomo instance.
 * Returns { ok: true, proxies } with only the nodes the core actually
 * connected through, or { ok: false, error } when the instance could not run.
 * It never returns unverified nodes as if they had passed.
 *
 * Each call uses its own freshly created temp directory: reusing one fixed
 * path raced with the previous run's still-open file handles on Windows
 * (EPERM writing the config), which silently degraded the whole sweep to the
 * unverified TCP set.
 */
async function probeViaCore(proxies, { timeoutMs = CORE_TIMEOUT_MS, concurrency = CORE_CONCURRENCY } = {}) {
    if (!proxies.length) return { ok: true, proxies: [] };
    if (!fs.existsSync(MIHOMO_RUN)) return { ok: false, error: `核心不存在: ${MIHOMO_RUN}` };

    let child = null;
    let dir = null;
    try {
        const apiPort = await freePort();
        // The throwaway core must not fight the user's core for the mixed port.
        const mixedPort = await freePort();
        dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'webflclash-probe-'));
        const configPath = path.join(dir, 'config.yaml');
        await writeFileAtomic(configPath, buildProbeConfig(proxies, apiPort, mixedPort));

        child = spawn(MIHOMO_RUN, ['-d', dir, '-f', configPath], {
            stdio: 'ignore',
            windowsHide: true
        });
        // A spawn failure must not become an uncaughtException.
        let exited = false;
        child.on('error', () => { exited = true; });
        child.on('exit', () => { exited = true; });

        if (!(await waitForCore(apiPort, CORE_START_TIMEOUT_MS, () => exited))) {
            return { ok: false, error: '临时核心启动失败' };
        }

        const verified = [];
        for (let i = 0; i < proxies.length; i += concurrency) {
            const batch = proxies.slice(i, i + concurrency);
            const results = await Promise.all(batch.map((p) => probeThroughCore(apiPort, p.name, timeoutMs)));
            batch.forEach((p, idx) => {
                if (results[idx] > 0) verified.push({ proxy: p, delay: results[idx] });
            });
        }
        return { ok: true, proxies: orderByDelay(verified) };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        if (child && child.pid) {
            try {
                child.kill('SIGKILL');
            } catch {
                // Already gone.
            }
        }
        if (dir) await removeDirWithRetry(dir);
    }
}

let running = false;

/**
 * Fetch every source, merge, probe, and write the aggregate profile.
 * Per-source problems never throw. The existing profile is left untouched
 * unless the real probe produced at least one verified node: writing an
 * unverified or empty set would replace a working profile with a broken one.
 */
async function refreshFreeAggregate() {
    if (running) return { started: false, busy: true };
    running = true;
    try {
        const sources = await loadFreeSources();
        // Fetch in parallel: each source is slow on a throttled network and
        // they are independent, so a sequential sweep wastes minutes.
        const fetched = await Promise.all(
            sources.map(async (src) => {
                try {
                    return { name: src.name, proxies: extractProxies(await fetchSourceText(src.url)) };
                } catch {
                    return { name: src.name, proxies: [] };
                }
            })
        );
        const failedSources = fetched.filter((r) => !r.proxies.length).map((r) => r.name);
        const groups = fetched.filter((r) => r.proxies.length).map((r) => r.proxies);

        const merged = mergeProxies(groups);
        if (!merged.length) {
            const result = { ok: false, error: '所有免费源均未获取到节点', failedSources, total: 0 };
            await updateMeta((meta) => {
                meta[FREE_AGGREGATE_FILE] = meta[FREE_AGGREGATE_FILE] || {};
                meta[FREE_AGGREGATE_FILE].lastRun = { at: Date.now(), ...result };
            });
            return { started: true, ...result };
        }

        // Stage 1: cheap TCP filter; also shrinks what the throwaway core loads.
        const tcpAlive = await probeAll(merged);
        // Stage 2: real handshake test. Only these nodes are trustworthy.
        const probe = await probeViaCore(tcpAlive);

        const stats = {
            at: Date.now(),
            sources: sources.length,
            failedSources,
            total: merged.length,
            tcpAlive: tcpAlive.length,
            coreAlive: probe.ok ? probe.proxies.length : null
        };

        if (!probe.ok) {
            // Do not overwrite a good profile with unverified nodes.
            const result = { ...stats, ok: false, error: `真实测活未完成（${probe.error}），已保留原配置` };
            await updateMeta((meta) => {
                meta[FREE_AGGREGATE_FILE] = meta[FREE_AGGREGATE_FILE] || {};
                meta[FREE_AGGREGATE_FILE].lastRun = result;
            });
            return { started: true, ...result };
        }

        const kept = probe.proxies.slice(0, MAX_KEEP);
        if (!kept.length) {
            const result = { ...stats, ok: false, error: '真实测活后没有可用节点，已保留原配置' };
            await updateMeta((meta) => {
                meta[FREE_AGGREGATE_FILE] = meta[FREE_AGGREGATE_FILE] || {};
                meta[FREE_AGGREGATE_FILE].lastRun = result;
            });
            return { started: true, ...result };
        }

        const intranet = await loadIntranet();
        const intranetBlock = {
            domainRules: domainDirectRules(intranet),
            privateRules: privateDirectRules(intranet),
            fakeIpFilter: fakeIpFilterEntries(intranet)
        };
        await writeFileAtomic(path.join(PROFILES_DIR, FREE_AGGREGATE_FILE), wrapAggregate(kept, intranetBlock));
        const finalStats = { ...stats, ok: true, alive: kept.length, kept: kept.length };
        await updateMeta((meta) => {
            meta[FREE_AGGREGATE_FILE] = meta[FREE_AGGREGATE_FILE] || {};
            meta[FREE_AGGREGATE_FILE].displayName = '免费聚合';
            meta[FREE_AGGREGATE_FILE].interval = meta[FREE_AGGREGATE_FILE].interval || DEFAULT_INTERVAL_MIN;
            meta[FREE_AGGREGATE_FILE].aggregate = true;
            meta[FREE_AGGREGATE_FILE].lastUpdate = Date.now();
            meta[FREE_AGGREGATE_FILE].lastRun = finalStats;
        });
        return { started: true, ...finalStats };
    } finally {
        running = false;
    }
}

function isRunning() {
    return running;
}

module.exports = {
    FREE_AGGREGATE_FILE,
    DEFAULT_SOURCES,
    loadFreeSources,
    fetchSourceText,
    extractProxies,
    mergeProxies,
    tcpProbe,
    probeAll,
    wrapAggregate,
    orderByDelay,
    probeViaCore,
    buildProbeConfig,
    refreshFreeAggregate,
    isRunning
};
