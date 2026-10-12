'use strict';
// Log-frame handling.
//
// mihomo's /logs stream emits only {type, payload}. The console renders a
// timestamp prefix, so without a stamp every line showed an empty "[]".
const test = require('node:test');
const assert = require('node:assert');
const { parseLogFrame } = require('../server/lib/mihomo');

test('a frame is parsed and stamped with a receive time', () => {
    const frame = parseLogFrame('{"type":"info","payload":"[TCP] example.com:443"}');
    assert.strictEqual(frame.type, 'info');
    assert.strictEqual(frame.payload, '[TCP] example.com:443');
    assert.match(frame.time, /^\d{2}:\d{2}:\d{2}$/, 'time must be HH:MM:SS');
});

test('a time supplied by the core is preserved', () => {
    const frame = parseLogFrame('{"type":"warning","payload":"x","time":"01:02:03"}');
    assert.strictEqual(frame.time, '01:02:03');
});

test('surrounding whitespace and a trailing newline are tolerated', () => {
    const frame = parseLogFrame('  {"type":"info","payload":"y"}\n');
    assert.strictEqual(frame.payload, 'y');
    assert.ok(frame.time);
});

test('the payload is passed through verbatim, including non-ASCII node names', () => {
    const payload = '[TCP] 127.0.0.1:1 --> a.com:443 using 一元机场[🇯🇵日本 09]';
    const frame = parseLogFrame(JSON.stringify({ type: 'info', payload }));
    assert.strictEqual(frame.payload, payload);
});

test('a partial line throws so the caller can skip it', () => {
    assert.throws(() => parseLogFrame('{"type":"info","payl'));
    assert.throws(() => parseLogFrame('not json at all'));
});
