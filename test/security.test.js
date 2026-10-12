'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkRequest, checkUpgrade, REQUEST_HEADER } = require('../server/lib/security');

const HOST = { host: '127.0.0.1:7891' };
const LOCAL = { host: 'localhost:7891' };

test('allows a plain same-origin GET', () => {
    assert.strictEqual(checkRequest({ method: 'GET', headers: HOST }), null);
});

test('allows the console origin', () => {
    assert.strictEqual(checkRequest({ method: 'GET', headers: { ...HOST, origin: 'http://127.0.0.1:7891' } }), null);
    assert.strictEqual(checkRequest({ method: 'GET', headers: { ...LOCAL, origin: 'http://localhost:7891' } }), null);
});

test('rejects an unknown Host (DNS rebinding)', () => {
    assert.strictEqual(checkRequest({ method: 'GET', headers: { host: 'evil.com:7891' } }), 'bad-host');
    assert.strictEqual(checkRequest({ method: 'GET', headers: {} }), 'bad-host');
});

test('rejects a cross-site Origin', () => {
    assert.strictEqual(
        checkRequest({ method: 'GET', headers: { ...HOST, origin: 'http://evil.example' } }),
        'bad-origin'
    );
});

test('rejects a cross-site Referer when Origin is absent', () => {
    assert.strictEqual(
        checkRequest({ method: 'GET', headers: { ...HOST, referer: 'http://evil.example/page' } }),
        'bad-referer'
    );
});

test('a state-changing request must carry the console header', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        assert.strictEqual(checkRequest({ method, headers: HOST }), 'missing-request-header', method);
        assert.strictEqual(checkRequest({ method, headers: { ...HOST, [REQUEST_HEADER]: '1' } }), null, method);
    }
});

test('reads are not required to carry the console header', () => {
    assert.strictEqual(checkRequest({ method: 'GET', headers: HOST }), null);
    assert.strictEqual(checkRequest({ method: 'HEAD', headers: HOST }), null);
});

test('the reported attack still fails: cross-site POST /stop', () => {
    // This is the exact shape a hostile page can produce with a simple form or
    // a text/plain fetch: correct host, foreign origin, no custom header.
    const hostile = {
        method: 'POST',
        headers: {
            host: '127.0.0.1:7891',
            origin: 'http://attacker.example',
            'content-type': 'text/plain'
        }
    };
    assert.strictEqual(checkRequest(hostile), 'bad-origin');

    // Even with the origin stripped (some legacy paths omit it), the missing
    // custom header still blocks it.
    const noOrigin = { method: 'POST', headers: { host: '127.0.0.1:7891', 'content-type': 'text/plain' } };
    assert.strictEqual(checkRequest(noOrigin), 'missing-request-header');
});

test('malformed Origin values are rejected, not thrown on', () => {
    for (const origin of ['not a url', 'null', 'http://127.0.0.1:9999', 'https://127.0.0.1:7891']) {
        assert.strictEqual(checkRequest({ method: 'GET', headers: { ...HOST, origin } }), 'bad-origin', origin);
    }
});

test('WebSocket upgrade: browser origins must match, non-browser may omit it', () => {
    assert.strictEqual(checkUpgrade({ headers: { host: '127.0.0.1:7891' } }), null);
    assert.strictEqual(checkUpgrade({ headers: { ...HOST, origin: 'http://127.0.0.1:7891' } }), null);
    assert.strictEqual(checkUpgrade({ headers: { ...HOST, origin: 'http://evil.example' } }), 'bad-origin');
    assert.strictEqual(checkUpgrade({ headers: { host: 'evil.example:7891' } }), 'bad-host');
});
