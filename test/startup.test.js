'use strict';
// Regression test for fatal-startup handling.
//
// `ws` re-emits the HTTP server's 'error' event on its own emitter. An
// EventEmitter with no 'error' listener throws, so the failure surfaced as an
// uncaughtException and bypassed the intended message. createApp() must route
// both emitters into one reporter.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createApp, ensureDirectories } = require('../server/app');

/** Grab an ephemeral port, then hold it so listen() must fail. */
function holdPort() {
    return new Promise((resolve) => {
        const blocker = http.createServer();
        blocker.listen(0, '127.0.0.1', () => resolve(blocker));
    });
}

test('a port conflict is reported through onError, not as an uncaughtException', async () => {
    ensureDirectories();
    const blocker = await holdPort();
    const { port } = blocker.address();

    const seen = [];
    const app = createApp({ onError: (err) => seen.push(err) });
    // createApp binds nothing yet; listen on the occupied port ourselves.
    const { app: _ignored, server, wss } = app;
    void _ignored;

    await new Promise((resolve) => {
        server.once('listening', resolve);
        server.listen(port, '127.0.0.1');
        // Give the error a chance to arrive; listening should never fire.
        setTimeout(resolve, 1500);
    });

    assert.ok(seen.length >= 1, 'onError should have been called');
    assert.strictEqual(seen[0].code, 'EADDRINUSE');
    assert.strictEqual(seen.length, 1, 'the error must be reported exactly once, not twice');

    // Both emitters must carry a listener, or EventEmitter would throw.
    assert.ok(server.listenerCount('error') >= 1, 'http server needs an error listener');
    assert.ok(wss.listenerCount('error') >= 1, 'ws server needs an error listener');

    wss.close();
    server.close();
    await new Promise((resolve) => blocker.close(resolve));
});

test('createApp exposes the pieces the entry point wires up', () => {
    ensureDirectories();
    const { app, server, wss } = createApp({ onError: () => {} });
    assert.strictEqual(typeof app, 'function', 'express app is callable');
    assert.strictEqual(typeof server.listen, 'function');
    assert.strictEqual(typeof wss.close, 'function');
    wss.close();
    server.close();
});
