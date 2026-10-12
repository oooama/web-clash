'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultConfig, DEFAULT_RULES } = require('../server/lib/config');
const { writeFileAtomic, writeFileQueued, serialized } = require('../server/lib/atomic');
const { applySubscriptionInfo } = require('../server/lib/meta');
const { MIXED_PORT, CLASH_API_PORT } = require('../server/constants');

test('defaultConfig is a bootable rule-mode document', () => {
    const cfg = defaultConfig();
    assert.strictEqual(cfg['mixed-port'], MIXED_PORT);
    assert.strictEqual(cfg['external-controller'], `127.0.0.1:${CLASH_API_PORT}`);
    assert.strictEqual(cfg.mode, 'rule');
    assert.strictEqual(cfg['allow-lan'], false);
    assert.strictEqual(cfg['find-process-mode'], 'strict');
    assert.strictEqual(cfg['tcp-concurrent'], true);
    assert.deepStrictEqual(cfg.tun, { enable: false });
    assert.strictEqual(cfg.dns.enable, true);
    assert.strictEqual(cfg.sniffer.enable, true);
    assert.deepStrictEqual(cfg.proxies, []);
    assert.deepStrictEqual(cfg['proxy-groups'][0], { name: 'Proxy', type: 'select', proxies: ['DIRECT'] });
    assert.strictEqual(cfg['proxy-groups'][1].type, 'url-test');
    assert.deepStrictEqual(cfg.rules, DEFAULT_RULES);
    // Every rule target must resolve against the groups above.
    const groupNames = cfg['proxy-groups'].map((g) => g.name);
    for (const rule of cfg.rules) {
        const target = rule.split(',')[2];
        if (!target || ['DIRECT', 'REJECT', 'no-resolve'].includes(target)) continue;
        assert.ok(groupNames.includes(target), `rule target ${target} has no group`);
    }
});

test('defaultConfig returns a fresh object each call', () => {
    const a = defaultConfig();
    a.rules.push('MATCH,DIRECT');
    a.proxies.push({ name: 'leak' });
    a['proxy-groups'][0].proxies.push('leak');
    a.dns.nameserver.push('leak');
    a.sniffer.sniff.TLS.ports.push(1);
    const b = defaultConfig();
    assert.deepStrictEqual(b.rules, DEFAULT_RULES);
    assert.deepStrictEqual(b.proxies, []);
    assert.deepStrictEqual(b['proxy-groups'][0].proxies, ['DIRECT']);
    assert.deepStrictEqual(b.dns.nameserver, ['223.5.5.5', '1.12.12.12']);
    assert.deepStrictEqual(b.sniffer.sniff.TLS.ports, [443, 8443]);
});

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webflclash-test-'));
}

test('writeFileAtomic leaves no temp files behind', async () => {
    const dir = tmpDir();
    const target = path.join(dir, 'config.yaml');
    await writeFileAtomic(target, 'a: 1\n');
    await writeFileAtomic(target, 'a: 2\n');
    assert.strictEqual(fs.readFileSync(target, 'utf8'), 'a: 2\n');
    assert.deepStrictEqual(fs.readdirSync(dir), ['config.yaml']);
});

test('writeFileAtomic replaces the file rather than truncating in place', async () => {
    const dir = tmpDir();
    const target = path.join(dir, 'meta.json');
    await writeFileAtomic(target, JSON.stringify({ big: 'x'.repeat(4096) }));
    await writeFileAtomic(target, JSON.stringify({ small: 1 }));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { small: 1 });
    assert.deepStrictEqual(fs.readdirSync(dir), ['meta.json']);
});

test('concurrent queued writes to one path do not interleave', async () => {
    const dir = tmpDir();
    const target = path.join(dir, 'profile-meta.json');
    const order = [];
    await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
            writeFileQueued(target, JSON.stringify({ writer: i })).then(() => order.push(i))
        )
    );
    // The queue is FIFO, so writers complete in the order they were queued.
    assert.deepStrictEqual(order, Array.from({ length: 20 }, (_, i) => i));
    assert.deepStrictEqual(fs.readdirSync(dir), ['profile-meta.json']);
});

test('a failing task does not poison the queue for later callers', async () => {
    const dir = tmpDir();
    const key = path.join(dir, 'x');
    await assert.rejects(
        serialized(key, async () => {
            throw new Error('boom');
        })
    );
    const result = await serialized(key, async () => 'after');
    assert.strictEqual(result, 'after');
});

test('applySubscriptionInfo copies counters and tolerates partial headers', () => {
    const target = {};
    applySubscriptionInfo(target, { upload: 1, download: 2, total: 3, expire: 4 });
    assert.deepStrictEqual(target, { upload: 1, download: 2, total: 3, expire: 4 });

    const partial = { upload: 9 };
    applySubscriptionInfo(partial, { total: 100 });
    assert.deepStrictEqual(partial, { upload: 9, total: 100 });

    const untouched = {};
    applySubscriptionInfo(untouched, null);
    assert.deepStrictEqual(untouched, {});
});
