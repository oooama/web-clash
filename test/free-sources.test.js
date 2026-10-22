'use strict';
// Unit tests for the free-aggregate helpers: endpoint de-duplication, name
// collision handling, source-body extraction, TCP probing, and the seeded
// source list. Network-independent by design.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeProxies, tcpProbe, extractProxies, loadFreeSources, buildProbeConfig, wrapAggregate, orderByDelay, DEFAULT_SOURCES } = require('../server/lib/free-sources');
const YAML = require('yaml');

test('mergeProxies collapses duplicate endpoints across sources', () => {
    const a = [
        { name: 'JP-1', type: 'ss', server: '1.1.1.1', port: 443 },
        { name: 'US-1', type: 'trojan', server: '2.2.2.2', port: 443 }
    ];
    const b = [
        { name: 'JP-1-copy', type: 'ss', server: '1.1.1.1', port: 443 },
        { name: 'JP-1', type: 'ss', server: '3.3.3.3', port: 443 }
    ];
    const merged = mergeProxies([a, b]);
    assert.strictEqual(merged.length, 3);
    // The same endpoint from a second source is dropped.
    assert.strictEqual(merged.filter((p) => p.server === '1.1.1.1').length, 1);
    // A different node reusing an existing name gets a suffix.
    assert.ok(merged.some((p) => p.server === '3.3.3.3' && p.name === 'JP-1 #2'));
});

test('mergeProxies skips malformed entries and non-array groups', () => {
    const merged = mergeProxies([
        [{ name: 'x', server: 'h', port: 0 }, null, { name: 'ok', type: 'ss', server: 'h', port: 1 }],
        'not-an-array'
    ]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].name, 'ok');
});

test('extractProxies handles share-link lists', () => {
    const links = 'ss://YWVzLTI1Ni1nY206cGFzcw==@1.2.3.4:8388#NodeA\nvmess://not-valid-base64-json';
    const r = extractProxies(links);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'NodeA');
    assert.strictEqual(r[0].server, '1.2.3.4');
});

test('extractProxies handles Clash YAML documents', () => {
    const yaml = 'proxies:\n  - {name: NodeB, type: ss, server: 5.6.7.8, port: 443, cipher: aes-128-gcm, password: pw, udp: true}\nrules:\n  - MATCH,DIRECT\n';
    const r = extractProxies(yaml);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'NodeB');
});

test('same endpoint + different credentials = two distinct nodes', () => {
    // The old type|server|port key collapsed these; on a live free source that
    // dropped 142/351 real nodes. Identical credentials on one endpoint are
    // still merged, but anything that changes the tunnel must survive.
    const merged = mergeProxies([[
        { name: 'A', type: 'vless', server: 'cdn.example.com', port: 443, uuid: 'uuid-1' },
        { name: 'B', type: 'vless', server: 'cdn.example.com', port: 443, uuid: 'uuid-2' }
    ]]);
    assert.strictEqual(merged.length, 2, 'different uuids must survive');
});

test('same endpoint + different transport = two distinct nodes', () => {
    const merged = mergeProxies([[
        { name: 'W', type: 'vmess', server: 'x.com', port: 443, network: 'ws', path: '/a' },
        { name: 'G', type: 'vmess', server: 'x.com', port: 443, network: 'grpc' }
    ]]);
    assert.strictEqual(merged.length, 2, 'different transports must survive');
});

test('same endpoint + identical credentials across sources = still merged', () => {
    // A node re-listed by a second aggregator is still the same node.
    const merged = mergeProxies([
        [{ name: 'N', type: 'ss', server: 's', port: 443, cipher: 'aes-128-gcm', password: 'p' }],
        [{ name: 'N-copy', type: 'ss', server: 's', port: 443, cipher: 'aes-128-gcm', password: 'p' }]
    ]);
    assert.strictEqual(merged.length, 1, 'genuinely identical nodes merge');
});

test('tcpProbe resolves true for a listening port and false otherwise', async () => {
    const srv = net.createServer(() => {});
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = srv.address().port;
    assert.strictEqual(await tcpProbe({ server: '127.0.0.1', port }, 1000), true);
    // Port 1 on loopback is closed in practice; a refused connection is dead.
    assert.strictEqual(await tcpProbe({ server: '127.0.0.1', port: 1 }, 800), false);
    await new Promise((resolve) => srv.close(resolve));
});

test('loadFreeSources seeds the default list once and honours edits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-sources-'));
    const file = path.join(dir, 'free-sources.json');
    try {
        const first = await loadFreeSources(file);
        assert.strictEqual(first.length, DEFAULT_SOURCES.length);
        assert.ok(fs.existsSync(file));
        // A hand-edited file wins over the defaults.
        fs.writeFileSync(file, JSON.stringify([{ name: 'custom', url: 'https://example.com/sub' }]));
        const second = await loadFreeSources(file);
        assert.deepStrictEqual(second, [{ name: 'custom', url: 'https://example.com/sub' }]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('buildProbeConfig wires the candidates into a minimal probe config', () => {
    const proxies = [
        { name: 'A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' },
        { name: 'B', type: 'trojan', server: '2.2.2.2', port: 443, password: 'p' }
    ];
    const doc = YAML.parse(buildProbeConfig(proxies, 19090, 19091));
    assert.strictEqual(doc['external-controller'], '127.0.0.1:19090');
    // The throwaway core must take its own mixed port, never the user's 7890.
    assert.strictEqual(doc['mixed-port'], 19091);
    assert.strictEqual(doc.proxies.length, 2);
    assert.deepStrictEqual(doc['proxy-groups'][0].proxies, ['A', 'B']);
    // Probing must never route real traffic through the candidates.
    assert.deepStrictEqual(doc.rules, ['MATCH,DIRECT']);
});

test('wrapAggregate defaults the select group to the url-test group', () => {
    const doc = YAML.parse(wrapAggregate([
        { name: 'A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' }
    ]));
    const select = doc['proxy-groups'].find((g) => g.name === 'Proxy');
    const auto = doc['proxy-groups'].find((g) => g.name === 'Auto');
    // A select group starting at DIRECT sends blocked sites straight out, which
    // reads as "no node works"; the first option must be the url-test group.
    assert.strictEqual(select.proxies[0], 'Auto');
    assert.ok(select.proxies.includes('DIRECT'), 'DIRECT stays selectable');
    assert.strictEqual(auto.type, 'url-test');
    assert.deepStrictEqual(auto.proxies, ['A']);
    assert.strictEqual(doc.rules[doc.rules.length - 1], 'MATCH,Proxy');
    // Failover must not wait for traffic: lazy:true (the default) skips health
    // checks while idle, so a node that died would only be noticed on the next
    // browsing session. One minute keeps the switch-over window short.
    assert.strictEqual(auto.lazy, false);
    assert.strictEqual(auto.interval, 60);
});

test('orderByDelay puts the fastest verified node first', () => {
    const slow = { name: 'slow', type: 'ss', server: '1.1.1.1', port: 1 };
    const fast = { name: 'fast', type: 'ss', server: '2.2.2.2', port: 2 };
    const mid = { name: 'mid', type: 'ss', server: '3.3.3.3', port: 3 };
    const ordered = orderByDelay([
        { proxy: slow, delay: 1200 },
        { proxy: fast, delay: 80 },
        { proxy: mid, delay: 400 }
    ]);
    // Before its first health check lands, url-test falls back to list order.
    assert.deepStrictEqual(ordered.map((p) => p.name), ['fast', 'mid', 'slow']);
});
