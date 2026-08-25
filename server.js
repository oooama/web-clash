const express = require('express');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const YAML = require('yaml');

const fsp = fs.promises;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 7891;
const CLASH_API_PORT = 9090;
const MIXED_PORT = 7890;
const ROOT_DIR = __dirname;
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const MIHOMO_RUN = path.join(BIN_DIR, 'mihomo-run.exe');
const CONFIG_PATH = path.join(DATA_DIR, 'config.yaml');
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');
const PROFILE_META = path.join(ROOT_DIR, 'profile-meta.json');

// ===== Subscription converter (from web-clash) =====
function b64decode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/').trim();
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    const idx = pair.indexOf('=');
    if (idx < 0) { out[pair] = ''; continue; }
    out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
  }
  return out;
}

function nameFromFragment(frag) {
  return frag ? decodeURIComponent(frag) : '';
}

function parseVmess(uri) {
  try {
    const json = JSON.parse(b64decode(uri.slice('vmess://'.length)));
    const p = {
      name: json.ps || json.remarks || json.add || 'vmess',
      type: 'vmess',
      server: json.add,
      port: Number(json.port),
      uuid: json.id,
      alterId: Number(json.aid || 0),
      cipher: json.scy || json.cipher || 'auto',
      udp: true,
    };
    if (json.tls === 'tls' || json.tls === true) p.tls = true;
    if (json.sni) p.servername = json.sni;
    if (json.net && json.net !== 'tcp') p.network = json.net;
    if (json.net === 'ws') {
      p['ws-opts'] = { path: json.path || '/' };
      if (json.host) p['ws-opts'].headers = { Host: json.host };
    }
    if (json.net === 'grpc') p['grpc-opts'] = { 'grpc-service-name': json.path || '' };
    return p;
  } catch { return null; }
}

function parseVless(uri) {
  try {
    const u = new URL(uri);
    const q = parseQuery(u.search.slice(1));
    const p = {
      name: nameFromFragment(u.hash) || 'vless',
      type: 'vless',
      server: u.hostname,
      port: Number(u.port),
      uuid: u.username,
      udp: true,
    };
    if (q.flow) p.flow = q.flow;
    if (q.type && q.type !== 'tcp') p.network = q.type;
    if (q.security === 'tls' || q.security === 'reality') {
      p.tls = true;
      if (q.pbk) p['reality-opts'] = { 'public-key': q.pbk, 'short-id': q.sid || '' };
      if (q.sni) p.servername = q.sni;
    }
    if (q.type === 'ws') {
      p['ws-opts'] = { path: q.path || '/' };
      if (q.host) p['ws-opts'].headers = { Host: q.host };
    }
    if (q.type === 'grpc') p['grpc-opts'] = { 'grpc-service-name': q.serviceName || '' };
    return p;
  } catch { return null; }
}

function parseTrojan(uri) {
  try {
    const u = new URL(uri);
    const q = parseQuery(u.search.slice(1));
    const p = {
      name: nameFromFragment(u.hash) || 'trojan',
      type: 'trojan',
      server: u.hostname,
      port: Number(u.port),
      password: decodeURIComponent(u.username),
      udp: true,
    };
    if (q.sni) p.sni = q.sni;
    if (q.allowInsecure === '1') p['skip-cert-verify'] = true;
    if (q.type && q.type !== 'tcp') p.network = q.type;
    if (q.type === 'ws') {
      p['ws-opts'] = { path: q.path || '/' };
      if (q.host) p['ws-opts'].headers = { Host: q.host };
    }
    return p;
  } catch { return null; }
}

function parseSS(uri) {
  try {
    let rest = uri.slice('ss://'.length);
    const hashIdx = rest.indexOf('#');
    const name = hashIdx >= 0 ? decodeURIComponent(rest.slice(hashIdx + 1)) : '';
    if (hashIdx >= 0) rest = rest.slice(0, hashIdx);
    let main = rest;
    let query = {};
    const qIdx = rest.indexOf('?');
    if (qIdx >= 0) { query = parseQuery(rest.slice(qIdx + 1)); main = rest.slice(0, qIdx); }
    let method, password, server, port;
    if (main.includes('@')) {
      const [userinfo, hostport] = main.split('@');
      const dec = /^[A-Za-z0-9+/=_-]+$/.test(userinfo) && userinfo.length > 12 ? b64decode(userinfo) : userinfo;
      const ci = dec.indexOf(':');
      method = dec.slice(0, ci); password = dec.slice(ci + 1);
      const hi = hostport.lastIndexOf(':');
      server = hostport.slice(0, hi); port = Number(hostport.slice(hi + 1));
    } else {
      const dec = b64decode(main);
      const at = dec.lastIndexOf('@');
      const ci = dec.slice(0, at).indexOf(':');
      method = dec.slice(0, ci); password = dec.slice(ci + 1, at);
      const hostport = dec.slice(at + 1);
      const hi = hostport.lastIndexOf(':');
      server = hostport.slice(0, hi); port = Number(hostport.slice(hi + 1));
    }
    const p = { name: name || `${server}:${port}`, type: 'ss', server, port, cipher: method, password, udp: true };
    if (query.plugin) p.plugin = query.plugin;
    return p;
  } catch { return null; }
}

function parseSSR(uri) {
  try {
    const dec = b64decode(uri.slice('ssr://'.length));
    const [main, params] = dec.split('/?');
    const parts = main.split(':');
    if (parts.length < 6) return null;
    const [host, port, protocol, method, obfs, passB64] = parts;
    const q = parseQuery(params);
    return {
      name: q.remarks ? b64decode(q.remarks) : `${host}:${port}`,
      type: 'ssr',
      server: host,
      port: Number(port),
      cipher: method,
      password: b64decode(passB64),
      obfs,
      protocol,
      'obfs-param': q['obfs_param'] || '',
      'protocol-param': q['protoparam'] || '',
      udp: true,
    };
  } catch { return null; }
}

function convertSubscription(rawBody) {
  const proxies = [];
  let errors = 0;
  const trimmed = rawBody.trim();
  if (/^proxies:\s*$/m.test(trimmed) || trimmed.startsWith('proxies:')) {
    return { proxies: [], errors: 0, alreadyYaml: true };
  }
  let text = rawBody;
  if (/^[A-Za-z0-9+/=\s_-]+$/.test(text.replace(/\s/g, '')) && text.length > 32) {
    try { text = b64decode(text.replace(/\s/g, '')); } catch {}
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let p = null;
    if (line.startsWith('vmess://')) p = parseVmess(line);
    else if (line.startsWith('vless://')) p = parseVless(line);
    else if (line.startsWith('trojan://')) p = parseTrojan(line);
    else if (line.startsWith('ss://')) p = parseSS(line);
    else if (line.startsWith('ssr://')) p = parseSSR(line);
    if (p && p.server && p.port) {
      const base = p.name;
      let i = 2;
      while (proxies.some(x => x.name === p.name)) p.name = `${base}#${i++}`;
      proxies.push(p);
    } else {
      errors += 1;
    }
  }
  return { proxies, errors };
}

function wrapProxies(proxies) {
  const proxyNames = proxies.map(p => p.name);
  const doc = {
    proxies,
    'proxy-groups': [
      { name: 'Proxy', type: 'select', proxies: ['DIRECT', ...proxyNames] },
      { name: 'Auto', type: 'url-test', proxies: proxyNames.length ? proxyNames : ['DIRECT'], url: 'http://www.gstatic.com/generate_204', interval: 300 }
    ],
    rules: [
      'DOMAIN-SUFFIX,local,DIRECT',
      'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'GEOIP,CN,DIRECT,no-resolve',
      'MATCH,Proxy',
    ],
  };
  return YAML.stringify(doc, { lineWidth: -1, noRefs: true });
}
// ===== End converter =====

function sanitizeProfileName(name) {
    let safe = name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (!safe.endsWith('.yaml') && !safe.endsWith('.yml')) safe += '.yaml';
    const resolved = path.resolve(PROFILES_DIR, safe);
    if (!resolved.startsWith(PROFILES_DIR)) return null;
    return safe;
}

async function fetchAndConvertSub(url) {
    const resp = await fetch(url, {
        headers: { 'User-Agent': 'clash.meta', 'Accept': '*/*' },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow'
    });
    const subInfo = parseSubscriptionInfo(resp.headers);
    const text = await resp.text();
    if (/<html|<!DOCTYPE/i.test(text)) {
        return { error: '订阅链接被Cloudflare防护拦截，请更换链接或手动粘贴配置内容' };
    }
    const converted = convertSubscription(text);
    let yamlContent;
    if (converted.alreadyYaml) {
        try {
            const parsed = YAML.parse(text);
            if (!parsed || typeof parsed !== 'object' || (!parsed.proxies && !parsed['proxy-groups'])) {
                return { error: '订阅内容不是有效的代理配置，请尝试手动粘贴' };
            }
            yamlContent = text;
        } catch (e) {
            return { error: '订阅YAML解析失败: ' + e.message };
        }
    } else if (converted.proxies.length > 0) {
        yamlContent = wrapProxies(converted.proxies);
    } else {
        return { error: '订阅内容无法解析（未找到任何节点），请尝试手动粘贴配置' };
    }
    return { yamlContent, subInfo };
}

if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

async function loadMeta() {
    try { return JSON.parse(await fsp.readFile(PROFILE_META, 'utf8')); } catch { return {}; }
}
async function saveMeta(m) { await fsp.writeFile(PROFILE_META, JSON.stringify(m, null, 2)); }
let metaWriteQueue = Promise.resolve();
function updateMeta(mutator) {
    const next = metaWriteQueue.catch(() => {}).then(async () => {
        const meta = await loadMeta();
        const result = await mutator(meta);
        await saveMeta(meta);
        return result;
    });
    metaWriteQueue = next.catch(() => {});
    return next;
}

function parseSubscriptionInfo(headers) {
    const info = {};
    const raw = headers.get('subscription-userinfo');
    if (raw) {
        for (const part of raw.split(';')) {
            const [k, v] = part.trim().split('=');
            const value = Number(v);
            if (k && Number.isFinite(value)) info[k.trim().toLowerCase()] = value;
        }
    }
    const updateInterval = headers.get('profile-update-interval');
    if (updateInterval) info.updateInterval = Number(updateInterval);
    return info;
}

function hasSubscriptionInfo(info) {
    return ['upload', 'download', 'total', 'expire'].some(key => info[key] !== undefined);
}

async function generateConfig(profile) {
    const p = profile || {};
    const proxyNames = (p.proxies || []).map(n => n.name || n);
    const config = {
        'mixed-port': MIXED_PORT,
        'allow-lan': false,
        'mode': 'rule',
        'log-level': 'info',
        'ipv6': false,
        'external-controller': `127.0.0.1:${CLASH_API_PORT}`,
        'find-process-mode': 'strict',
        'tcp-concurrent': true,
        'geodata-mode': true,
        'geodata-loader': 'standard',
        'tun': { 'enable': false },
        'dns': {
            'enable': true,
            'ipv6': false,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'fake-ip-filter': ['*.lan', '*.local', '+.msftconnecttest.com', '+.msftncsi.com'],
            'default-nameserver': ['223.5.5.5', '1.12.12.12'],
            'nameserver': ['223.5.5.5', '1.12.12.12'],
            'fallback': ['8.8.8.8', '1.1.1.1'],
            'fallback-filter': { 'geoip': true, 'geoip-code': 'CN' }
        },
        'sniffer': {
            'enable': true,
            'force-dns-mapping': true,
            'parse-pure-ip': true,
            'sniff': {
                'HTTP': { 'ports': [80, '8080-8880'], 'override-destination': true },
                'TLS': { 'ports': [443, 8443] },
                'QUIC': { 'ports': [443, 8443] }
            }
        },
        'profile': { 'store-selected': true },
        'proxies': p.proxies || [],
        'proxy-groups': p['proxy-groups'] || [
            { 'name': 'Proxy', 'type': 'select', 'proxies': ['DIRECT', ...proxyNames] },
            { 'name': 'Auto', 'type': 'url-test', 'proxies': proxyNames.length ? proxyNames : ['DIRECT'], 'url': 'http://www.gstatic.com/generate_204', 'interval': 300 }
        ],
        'rules': p.rules || [
            'DOMAIN-SUFFIX,local,DIRECT',
            'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
            'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
            'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
            'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
            'GEOIP,CN,DIRECT,no-resolve',
            'MATCH,Proxy'
        ]
    };
    const text = YAML.stringify(config);
    await fsp.writeFile(CONFIG_PATH, text);
    return config;
}

// Probe if mihomo external controller is reachable
async function probeCore() {
    try {
        const res = await fetch(`http://127.0.0.1:${CLASH_API_PORT}/`, {
            signal: AbortSignal.timeout(2000)
        });
        return res.ok || res.status === 401;
    } catch {
        return false;
    }
}

const SKIP_ROUTES = ['/status', '/config', '/profiles', '/start', '/stop', '/system-proxy', '/traffic', '/logs', '/rules'];

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.use('/api', async (req, res, next) => {
    for (const skip of SKIP_ROUTES) {
        if (req.path === skip || req.path.startsWith(skip + '/')) return next();
    }

    try {
        const mihomoUrl = `http://127.0.0.1:${CLASH_API_PORT}${req.url}`;
        const headers = { ...req.headers, host: `127.0.0.1:${CLASH_API_PORT}` };
        delete headers['content-length'];

        const options = { method: req.method, headers, signal: AbortSignal.timeout(3000) };
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
            options.body = JSON.stringify(req.body);
        }

        const mihomoResp = await fetch(mihomoUrl, options);
        const text = await mihomoResp.text();
        let body = text;
        try {
            const json = JSON.parse(text);
            if (json.proxies && !Array.isArray(json.proxies) && req.path === '/proxies') {
                body = JSON.stringify(json.proxies);
            }
        } catch {}
        res.setHeader('content-type', 'application/json');
        res.status(mihomoResp.status);
        res.send(body);
    } catch (err) {
        if (!res.headersSent) {
            res.status(502).json({ error: 'mihomo core not running' });
        }
    }
});


wss.on('connection', (ws) => {
    console.log('[ws] client connected');
    ws.on('close', () => console.log('[ws] client disconnected'));
});

// Persistent log stream from mihomo
let logBuffer = [];
let logStream = null;
let logRetryTimer = null;
let logRetryDelay = 1000;
let logReconnectEnabled = false;
function connectLogStream() {
    logReconnectEnabled = true;
    if (logRetryTimer) { clearTimeout(logRetryTimer); logRetryTimer = null; }
    if (logStream) { try { logStream.destroy(); } catch {} logStream = null; }
    const httpMod = require('http');
    logStream = httpMod.get(`http://127.0.0.1:${CLASH_API_PORT}/logs`, (res) => {
        logRetryDelay = 1000;
        let lineBuf = '';
        res.on('data', (chunk) => {
            lineBuf += chunk.toString();
            const lines = lineBuf.split('\n');
            lineBuf = lines.pop();
            for (const line of lines) {
                try {
                    const obj = JSON.parse(line.trim());
                    logBuffer.push(obj);
                    if (logBuffer.length > 500) logBuffer.shift();
                    wss.clients.forEach(ws => {
                        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'log', ...obj }));
                    });
                } catch {}
            }
        });
        res.on('end', () => { logStream = null; });
    });
    const scheduleReconnect = () => {
        logStream = null;
        if (!logReconnectEnabled) return;
        if (logRetryTimer) return;
        logRetryTimer = setTimeout(() => {
            if (!logReconnectEnabled) return;
            logRetryTimer = null;
            logRetryDelay = Math.min(logRetryDelay * 2, 30000);
            connectLogStream();
        }, logRetryDelay);
    };
    logStream.on('error', scheduleReconnect);
    logStream.on('close', scheduleReconnect);
}
function disconnectLogStream() {
    logReconnectEnabled = false;
    if (logRetryTimer) { clearTimeout(logRetryTimer); logRetryTimer = null; }
    logRetryDelay = 1000;
    if (logStream) { try { logStream.destroy(); } catch {} logStream = null; }
    logBuffer = [];
}

// === API Routes ===

let coreStartedAt = null;
let coreWasRunning = false;

function getCoreMemory() {
    return new Promise((resolve) => {
        exec('tasklist /FI "IMAGENAME eq mihomo-run.exe" /FO CSV /NH', { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout) return resolve(0);
            const m = stdout.match(/"([\d,]+)\s*K"/);
            resolve(m ? parseInt(m[1].replace(/,/g, ''), 10) * 1024 : 0);
        });
    });
}

app.get('/api/status', async (req, res) => {
    const running = await probeCore();
    if (running && !coreWasRunning) coreStartedAt = Date.now();
    if (!running) coreStartedAt = null;
    coreWasRunning = running;
    const memory = running ? await getCoreMemory() : 0;
    res.json({
        running,
        ports: { mixed: MIXED_PORT, api: CLASH_API_PORT },
        uptime: coreStartedAt ? Math.floor((Date.now() - coreStartedAt) / 1000) : 0,
        memory
    });
});

app.post('/api/start', (req, res) => {
    res.json({ success: true });
    try {
        const child = spawn(MIHOMO_RUN, ['-d', DATA_DIR, '-f', CONFIG_PATH], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();
        console.log('[start] mihomo started, pid:', child.pid);
        setTimeout(connectLogStream, 2000);
    } catch (e) {
        console.error('[start] failed:', e.message);
    }
});

app.post('/api/stop', (req, res) => {
    res.json({ success: true });
    disconnectLogStream();
    exec('taskkill /F /IM mihomo-run.exe', () => {});
});

app.post('/api/system-proxy', (req, res) => {
    const { enable } = req.body;
    const port = MIXED_PORT;
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    if (enable) {
        exec(`reg add "${key}" /v ProxyEnable /t REG_DWORD /d 1 /f`, { timeout: 3000 }, (e1) => {
            exec(`reg add "${key}" /v ProxyServer /t REG_SZ /d "127.0.0.1:${port}" /f`, { timeout: 3000 }, (e2) => {
                res.json({ success: !e1 && !e2 });
            });
        });
    } else {
        exec(`reg add "${key}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { timeout: 3000 }, (e1) => {
            res.json({ success: !e1 });
        });
    }
});

app.get('/api/system-proxy', (req, res) => {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    exec(`reg query "${key}" /v ProxyEnable`, { timeout: 5000 }, (err, stdout) => {
        const enabled = stdout && stdout.includes('0x1');
        res.json({ enabled });
    });
});

app.get('/api/traffic', (req, res) => {
    const httpMod = require('http');
    const req2 = httpMod.get(`http://127.0.0.1:${CLASH_API_PORT}/traffic`, (res2) => {
        let buf = '';
        const timer = setTimeout(() => {
            req2.destroy();
            const items = [];
            buf.split('\n').forEach(line => {
                try { const o = JSON.parse(line.trim()); items.push(o); } catch {}
            });
            res.json(items);
        }, 1500);
        res2.on('data', (c) => { buf += c; });
        res2.on('end', () => { clearTimeout(timer); res.json([]); });
    });
    req2.on('error', () => res.json([]));
    req2.setTimeout(2000, () => { req2.destroy(); res.json([]); });
});

app.get('/api/logs', (req, res) => {
    res.json(logBuffer.slice(-200));
});

app.get('/api/config', async (req, res) => {
    try {
        const content = fs.existsSync(CONFIG_PATH)
            ? await fsp.readFile(CONFIG_PATH, 'utf8')
            : null;
        res.json({ success: true, config: content ? YAML.parse(content) : null });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        await fsp.writeFile(CONFIG_PATH, YAML.stringify(req.body));
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/profiles', async (req, res) => {
    try {
        const meta = await loadMeta();
        const files = (await fsp.readdir(PROFILES_DIR))
            .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        const profiles = await Promise.all(files.map(async f => {
            const filePath = path.join(PROFILES_DIR, f);
            const [content, stat] = await Promise.all([
                fsp.readFile(filePath, 'utf8'),
                fsp.stat(filePath)
            ]);
            const info = meta[f] || {};
            let nodeCount = 0;
            try {
                const parsed = YAML.parse(content);
                if (Array.isArray(parsed?.proxies)) nodeCount = parsed.proxies.length;
            } catch {}
            return {
                name: f,
                displayName: info.displayName || f.replace(/\.yaml$|\.yml$/, ''),
                nodeCount,
                size: Buffer.byteLength(content),
                modified: stat.mtime,
                url: info.url || null,
                interval: info.interval || 0,
                lastUpdate: info.lastUpdate || null,
                upload: info.upload || 0,
                download: info.download || 0,
                total: info.total || 0,
                expire: info.expire || 0
            };
        }));
        res.json({ success: true, profiles, active: meta._active || '' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/profiles', async (req, res) => {
    try {
        let { name, content, url } = req.body;
        const userProvidedName = !!name;
        let subInfo = {};
        if (url) {
            const result = await fetchAndConvertSub(url);
            if (result.error) return res.json({ success: false, error: result.error });
            content = result.yamlContent;
            subInfo = result.subInfo;
            if (!name) name = 'sub_' + Date.now();
        }
        if (!name || !content) return res.json({ success: false, error: 'name and content required' });
        const safeName = sanitizeProfileName(name);
        if (!safeName) return res.json({ success: false, error: 'Invalid profile name' });
        await fsp.writeFile(path.join(PROFILES_DIR, safeName), content);
        await updateMeta((meta) => {
            meta[safeName] = meta[safeName] || {};
            if (url) meta[safeName].url = url;
            if (userProvidedName && name) meta[safeName].displayName = name;
            if (url && hasSubscriptionInfo(subInfo)) {
                meta[safeName].upload = subInfo.upload || 0;
                meta[safeName].download = subInfo.download || 0;
                meta[safeName].total = subInfo.total || 0;
                meta[safeName].expire = subInfo.expire || 0;
            }
            meta[safeName].lastUpdate = Date.now();
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.delete('/api/profiles/:name', async (req, res) => {
    try {
        const safeName = sanitizeProfileName(decodeURIComponent(req.params.name));
        if (!safeName) return res.json({ success: false, error: 'Invalid profile name' });
        const filePath = path.join(PROFILES_DIR, safeName);
        if (fs.existsSync(filePath)) await fsp.unlink(filePath);
        const wasActive = await updateMeta((meta) => {
            const active = meta._active === safeName;
            delete meta[safeName];
            if (active) meta._active = '';
            return active;
        });
        if (wasActive) {
            const defaultConfig = {
                'mixed-port': MIXED_PORT,
                'allow-lan': false,
                'mode': 'rule',
                'log-level': 'info',
                'ipv6': false,
                'external-controller': `127.0.0.1:${CLASH_API_PORT}`,
                'geodata-mode': true,
                'geodata-loader': 'standard',
                'proxies': [],
                'proxy-groups': [{ 'name': 'Proxy', 'type': 'select', 'proxies': ['DIRECT'] }],
                'rules': ['MATCH,DIRECT']
            };
            await fsp.writeFile(CONFIG_PATH, YAML.stringify(defaultConfig));
        }
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/profiles/:name/update', async (req, res) => {
    try {
        const safeName = sanitizeProfileName(decodeURIComponent(req.params.name));
        if (!safeName) return res.json({ success: false, error: 'Invalid profile name' });
        const meta = await loadMeta();
        const url = meta[safeName]?.url;
        if (!url) return res.json({ success: false, error: 'No subscription URL' });

        const result = await fetchAndConvertSub(url);
        if (result.error) return res.json({ success: false, error: result.error });

        const filePath = path.join(PROFILES_DIR, safeName);
        await fsp.writeFile(filePath, result.yamlContent);
        await updateMeta((meta) => {
            if (!meta[safeName]) meta[safeName] = {};
            if (hasSubscriptionInfo(result.subInfo)) {
                meta[safeName].upload = result.subInfo.upload || 0;
                meta[safeName].download = result.subInfo.download || 0;
                meta[safeName].total = result.subInfo.total || 0;
                meta[safeName].expire = result.subInfo.expire || 0;
            }
            meta[safeName].lastUpdate = Date.now();
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/profiles/:name/apply', async (req, res) => {
    try {
        const fileName = sanitizeProfileName(decodeURIComponent(req.params.name));
        if (!fileName) return res.json({ success: false, error: 'Invalid profile name' });
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });

        let profile;
        try {
            profile = YAML.parse(await fsp.readFile(filePath, 'utf8'));
            if (!profile || typeof profile !== 'object') throw new Error('invalid YAML');
        } catch (e) {
            return res.json({ success: false, error: '配置文件无效，请重新订阅: ' + e.message });
        }

        let base = {};
        if (fs.existsSync(CONFIG_PATH)) {
            base = YAML.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
        }
        base['mixed-port'] = base['mixed-port'] || MIXED_PORT;
        base['external-controller'] = base['external-controller'] || `127.0.0.1:${CLASH_API_PORT}`;
        base['geodata-mode'] = true;
        base['geodata-loader'] = 'standard';
        base.proxies = profile.proxies || [];
        base['proxy-groups'] = profile['proxy-groups'] || [];
        base.rules = profile.rules || [];

        await fsp.writeFile(CONFIG_PATH, YAML.stringify(base));

        await updateMeta((meta) => { meta._active = fileName; });

        disconnectLogStream();
        exec('taskkill /F /IM mihomo-run.exe', () => {});
        setTimeout(() => {
            try {
                const child = spawn(MIHOMO_RUN, ['-d', DATA_DIR, '-f', CONFIG_PATH], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true
                });
                child.unref();
                console.log('[apply] mihomo restarted, pid:', child.pid);
                setTimeout(connectLogStream, 2000);
            } catch (e) {
                console.error('[apply] restart failed:', e.message);
            }
        }, 1500);

        res.json({ success: true, message: 'Applied. Restarting mihomo core...' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.put('/api/profiles/:name/content', async (req, res) => {
    try {
        const fileName = sanitizeProfileName(decodeURIComponent(req.params.name));
        if (!fileName) return res.json({ success: false, error: 'Invalid profile name' });
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });
        const { content } = req.body;
        if (!content) return res.json({ success: false, error: 'content required' });
        await fsp.writeFile(filePath, content);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.put('/api/profiles/:name/meta', async (req, res) => {
    try {
        const fileName = sanitizeProfileName(decodeURIComponent(req.params.name));
        if (!fileName) return res.json({ success: false, error: 'Invalid profile name' });
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });
        const { url, interval, displayName } = req.body;
        await updateMeta((meta) => {
            if (!meta[fileName]) meta[fileName] = {};
            if (url !== undefined) meta[fileName].url = url || null;
            if (interval !== undefined) meta[fileName].interval = parseInt(interval) || 0;
            if (displayName !== undefined) meta[fileName].displayName = displayName || null;
        });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/rules', async (req, res) => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return res.json({ rules: [] });
        const config = YAML.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
        res.json({ rules: config.rules || [] });
    } catch (e) {
        res.json({ rules: [], error: e.message });
    }
});

app.put('/api/rules', async (req, res) => {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return res.json({ success: false, error: 'no config' });
        const config = YAML.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
        config.rules = req.body.rules || [];
        await fsp.writeFile(CONFIG_PATH, YAML.stringify(config));
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Auto-update subscriptions
async function autoUpdateSubs() {
    try {
        const metaSnapshot = await loadMeta();
        const now = Date.now();
        for (const [fileName, info] of Object.entries(metaSnapshot)) {
            if (!info.url || !info.interval || info.interval <= 0) continue;
            const lastMs = info.lastUpdate || 0;
            const intervalMs = info.interval * 60 * 1000;
            if (now - lastMs < intervalMs) continue;
            const filePath = path.join(PROFILES_DIR, fileName);
            if (!fs.existsSync(filePath)) continue;
            try {
                const result = await fetchAndConvertSub(info.url);
                if (result.error) continue;
                await fsp.writeFile(filePath, result.yamlContent);
                await updateMeta((meta) => {
                    if (!meta[fileName]) meta[fileName] = {};
                    meta[fileName].lastUpdate = now;
                    if (hasSubscriptionInfo(result.subInfo)) {
                        meta[fileName].upload = result.subInfo.upload || 0;
                        meta[fileName].download = result.subInfo.download || 0;
                        meta[fileName].total = result.subInfo.total || 0;
                        meta[fileName].expire = result.subInfo.expire || 0;
                    }
                });
                console.log(`[auto-update] ${fileName} updated`);
            } catch (e) {
                console.log(`[auto-update] ${fileName} failed: ${e.message}`);
            }
        }
    } catch {}
}
setInterval(autoUpdateSubs, 60000);

server.listen(PORT, '127.0.0.1', async () => {
    // Reset config if no profiles exist and no active profile is set
    try {
        const profiles = (await fsp.readdir(PROFILES_DIR)).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        const meta = await loadMeta();
        if (profiles.length === 0 && !meta._active) {
            const defaultConfig = {
                'mixed-port': MIXED_PORT,
                'allow-lan': false,
                'mode': 'rule',
                'log-level': 'info',
                'ipv6': false,
                'external-controller': `127.0.0.1:${CLASH_API_PORT}`,
                'geodata-mode': true,
                'geodata-loader': 'standard',
                'proxies': [],
                'proxy-groups': [{ 'name': 'Proxy', 'type': 'select', 'proxies': ['DIRECT'] }],
                'rules': ['MATCH,DIRECT']
            };
            await fsp.writeFile(CONFIG_PATH, YAML.stringify(defaultConfig));
            console.log('  Reset config: no profiles found');
        }
    } catch {}
    console.log(`\n  WebFlClash running at http://127.0.0.1:${PORT}\n`);
    console.log(`  Proxy:   http://127.0.0.1:${MIXED_PORT}`);
    console.log(`  API:     http://127.0.0.1:${CLASH_API_PORT}`);
    console.log(`\n  Start mihomo core first, then use this web UI to manage it.\n`);
    if (await probeCore()) connectLogStream();
});

process.on('uncaughtException', (e) => { console.error('[FATAL] uncaughtException:', e.message, e.stack); });
process.on('unhandledRejection', (e) => { console.error('[FATAL] unhandledRejection:', e); });
process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });
