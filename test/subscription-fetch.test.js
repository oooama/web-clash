'use strict';
// Subscription ingestion.
//
// The core-YAML branch below (a subscription that returns a complete Clash
// document rather than base64 share links) was never exercised, which is how it
// shipped with an unbound `YAML` identifier after the server was split into
// modules. These tests cover both shapes.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const YAML = require('yaml');
const { fetchAndConvertSub } = require('../server/lib/subscription-fetch');

/** Serve one canned response and return its base URL. */
function serve(handler) {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}/sub` });
        });
    });
}

test('a full Clash YAML subscription is stored verbatim', async () => {
    const document = [
        'mixed-port: 7890',
        'proxies:',
        "    - { name: 'Node A', type: vless, server: a.example, port: 443 }",
        'proxy-groups:',
        '    - { name: Proxy, type: select, proxies: [Node A] }',
        'rules:',
        '    - MATCH,Proxy',
        ''
    ].join('\n');

    const { server, url } = await serve((req, res) => {
        res.writeHead(200, {
            'content-type': 'text/html; charset=UTF-8',
            'subscription-userinfo': 'upload=541847; download=13667398; total=107374182400; expire=1794295101',
            'profile-update-interval': '24'
        });
        res.end(document);
    });

    try {
        const result = await fetchAndConvertSub(url);
        assert.strictEqual(result.error, undefined, `unexpected error: ${result.error}`);
        // Returned byte-for-byte, so provider rules and groups survive.
        assert.strictEqual(result.yamlContent, document);
        assert.strictEqual(YAML.parse(result.yamlContent).proxies.length, 1);
        // The traffic/expiry headers are captured for the profile card.
        assert.deepStrictEqual(result.subInfo, {
            upload: 541847,
            download: 13667398,
            total: 107374182400,
            expire: 1794295101,
            updateInterval: 24
        });
    } finally {
        server.close();
    }
});

test('a base64 share-link subscription is converted to a Clash document', async () => {
    const vmess = 'vmess://' + Buffer.from(JSON.stringify({
        v: '2', ps: 'Node B', add: '1.2.3.4', port: '443',
        id: '11111111-2222-3333-4444-555555555555', aid: '0', scy: 'auto', net: 'tcp'
    })).toString('base64');

    const { server, url } = await serve((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(Buffer.from(vmess, 'utf8').toString('base64'));
    });

    try {
        const result = await fetchAndConvertSub(url);
        assert.strictEqual(result.error, undefined, `unexpected error: ${result.error}`);
        const parsed = YAML.parse(result.yamlContent);
        assert.strictEqual(parsed.proxies.length, 1);
        assert.strictEqual(parsed.proxies[0].name, 'Node B');
        assert.ok(parsed['proxy-groups'].length >= 1, 'a group must be synthesised');
        assert.ok(parsed.rules.some((r) => r.startsWith('MATCH,')), 'a MATCH rule is required to boot');
    } finally {
        server.close();
    }
});

test('a Clash document with no proxies or groups is rejected', async () => {
    const { server, url } = await serve((req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('proxies:\n');
    });

    try {
        const result = await fetchAndConvertSub(url);
        assert.ok(result.error, 'expected an error');
        assert.strictEqual(result.yamlContent, undefined);
    } finally {
        server.close();
    }
});

test('an HTML interstitial (Cloudflare) is reported clearly', async () => {
    const { server, url } = await serve((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!DOCTYPE html><html><body>Just a moment...</body></html>');
    });

    try {
        const result = await fetchAndConvertSub(url);
        assert.match(result.error, /Cloudflare/);
    } finally {
        server.close();
    }
});

test('an unreachable subscription rejects rather than returning junk', async () => {
    // Port 1 is not listening; the caller is expected to handle the throw.
    await assert.rejects(fetchAndConvertSub('http://127.0.0.1:1/sub'));
});
