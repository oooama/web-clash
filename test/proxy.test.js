'use strict';
// Integration tests against a mock mihomo external controller.
//
// Both the /api passthrough (server/app.js proxyToCore) and the log stream
// (server/lib/mihomo.js) talk to the fixed controller port, so the mock has
// to bind it. When the port is taken - typically because a real core is
// running - the tests skip instead of failing or talking to the live core.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp, ensureDirectories } = require('../server/app');
const { CLASH_API_PORT } = require('../server/constants');
const mihomo = require('../server/lib/mihomo');

/** Issue a request with an explicit Host header (fetch forbids setting it). */
function request(port, method, path, headers, body) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        r.on('error', reject);
        if (body !== undefined) r.write(body);
        r.end();
    });
}

/** Bind the controller port; resolve null when it is already occupied. */
function bindController(handler) {
    return new Promise((resolve) => {
        const m = http.createServer(handler);
        m.once('error', () => resolve(null));
        m.listen(CLASH_API_PORT, '127.0.0.1', () => resolve(m));
    });
}

async function listenApp() {
    const { server } = createApp({ onError: () => {} });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
}

async function closeServer(server) {
    await new Promise((resolve) => server.close(resolve));
}

test('proxyToCore forwards to the controller with rewritten headers', async (t) => {
    ensureDirectories();

    const seen = [];
    const mock = await bindController((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            seen.push({
                method: req.method,
                url: req.url,
                host: req.headers.host,
                consoleHeader: req.headers['x-console-request'],
                body
            });
            res.setHeader('content-type', 'application/json');
            if (req.url === '/proxies') {
                res.end(JSON.stringify({ proxies: { DIRECT: { name: 'DIRECT' } }, extra: 'kept' }));
            } else {
                res.end(JSON.stringify({ ok: true, echo: body || null }));
            }
        });
    });
    if (!mock) return t.skip(`port ${CLASH_API_PORT} busy - a real core is probably running`);

    const server = await listenApp();
    const port = server.address().port;
    const HOST = { host: '127.0.0.1:7891' };

    await t.test('a plain GET is forwarded under the /api prefix stripped', async () => {
        const resp = await request(port, 'GET', '/api/version', HOST);
        assert.strictEqual(resp.status, 200);
        assert.deepStrictEqual(JSON.parse(resp.body), { ok: true, echo: null });
        assert.strictEqual(seen.at(-1).method, 'GET');
        assert.strictEqual(seen.at(-1).url, '/version');
    });

    await t.test('the Host header is rewritten to the controller', async () => {
        await request(port, 'GET', '/api/version', HOST);
        assert.strictEqual(seen.at(-1).host, `127.0.0.1:${CLASH_API_PORT}`);
    });

    await t.test('the console header is stripped before forwarding', async () => {
        await request(port, 'GET', '/api/version', { ...HOST, 'x-console-request': '1' });
        assert.strictEqual(seen.at(-1).consoleHeader, undefined);
    });

    await t.test('a POST body reaches the controller as JSON', async () => {
        const payload = JSON.stringify({ mode: 'global' });
        const resp = await request(port, 'POST', '/api/configs', {
            ...HOST,
            'x-console-request': '1',
            'content-type': 'application/json'
        }, payload);
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(seen.at(-1).method, 'POST');
        assert.strictEqual(seen.at(-1).body, payload);
    });

    await t.test('GET /proxies is reshaped from the object form to the array form', async () => {
        const resp = await request(port, 'GET', '/api/proxies', HOST);
        assert.strictEqual(resp.status, 200);
        assert.deepStrictEqual(JSON.parse(resp.body), { DIRECT: { name: 'DIRECT' } });
    });

    mock.close();
    await closeServer(server);
});

test('proxyToCore answers 502 when the controller is unreachable', async (t) => {
    ensureDirectories();

    const coreUp = await fetch(`http://127.0.0.1:${CLASH_API_PORT}/`, { signal: AbortSignal.timeout(500) })
        .then(() => true)
        .catch(() => false);
    if (coreUp) return t.skip(`something answers on port ${CLASH_API_PORT}; cannot prove the core is down`);

    const server = await listenApp();
    const resp = await request(server.address().port, 'GET', '/api/version', { host: '127.0.0.1:7891' });
    assert.strictEqual(resp.status, 502);
    assert.deepStrictEqual(JSON.parse(resp.body), { error: 'mihomo core not running' });
    await closeServer(server);
});

test('a second connectLogStream() must not clobber the new stream', async (t) => {
    // Regression for the parallel /logs connection leak: the stale error/close
    // handlers of the destroyed previous stream used to null out the freshly
    // created one and schedule a duplicate reconnect (POST /api/start hits
    // this path on its alreadyRunning branch).
    const mock = await bindController((req, res) => {
        if (req.url === '/logs') {
            res.writeHead(200, { 'content-type': 'application/x-ndjson' });
            // Hold the stream open, like the real core does.
            return;
        }
        res.statusCode = 404;
        res.end();
    });
    if (!mock) return t.skip(`port ${CLASH_API_PORT} busy - a real core is probably running`);

    mihomo.setBroadcaster(() => {});
    mihomo.connectLogStream();
    await new Promise((r) => setTimeout(r, 50));
    mihomo.connectLogStream();
    // Let the stale close/error events of the destroyed stream fire.
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(mihomo.isLogStreamConnected(), 'the current stream must survive stale close events');

    mihomo.disconnectLogStream();
    mock.close();
});
