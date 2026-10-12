'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { sanitizeProfileName } = require('../server/lib/paths');
const { PROFILES_DIR } = require('../server/constants');

test('keeps an ordinary name', () => {
    assert.strictEqual(sanitizeProfileName('__500.yaml'), '__500.yaml');
});

test('appends the .yaml extension when missing', () => {
    assert.strictEqual(sanitizeProfileName('my sub'), 'my_sub.yaml');
});

test('accepts .yml as well', () => {
    assert.strictEqual(sanitizeProfileName('a.yml'), 'a.yml');
});

test('replaces path separators so traversal cannot escape', () => {
    for (const hostile of ['../../evil', '..\\..\\evil', '/etc/passwd', 'C:\\Windows\\evil.yaml']) {
        const safe = sanitizeProfileName(hostile);
        assert.ok(safe, `expected a sanitised name for ${hostile}`);
        assert.ok(!safe.includes('/'), `${hostile} still contains a slash`);
        assert.ok(!safe.includes('\\'), `${hostile} still contains a backslash`);
        assert.strictEqual(path.dirname(path.resolve(PROFILES_DIR, safe)), path.resolve(PROFILES_DIR));
    }
});

test('rejects blank and non-string input', () => {
    for (const bad of ['', '   ', '.', '..', '...', null, undefined, 42, {}]) {
        assert.strictEqual(sanitizeProfileName(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
});

test('a non-ASCII (Chinese) name is accepted and confined', () => {
    // Regression: requiring an ASCII character rejected every pure-CJK name,
    // which blocked adding a Chinese-named subscription from the UI.
    const safe = sanitizeProfileName('赔钱机场');
    assert.strictEqual(safe, '____.yaml');
    assert.strictEqual(path.dirname(path.resolve(PROFILES_DIR, safe)), path.resolve(PROFILES_DIR));

    // A CJK name with a .yaml suffix keeps exactly one extension.
    assert.strictEqual(sanitizeProfileName('赔钱机场.yaml'), '____.yaml');
});

test('a name that is only dots or whitespace is still rejected', () => {
    for (const bad of ['.', '..', '...', ' . . ', '\t.']) {
        assert.strictEqual(sanitizeProfileName(bad), null, JSON.stringify(bad));
    }
});

test('a sanitised name is always a direct child of PROFILES_DIR', () => {
    const safe = sanitizeProfileName('weird name/with:chars*');
    assert.ok(safe);
    assert.strictEqual(path.dirname(path.resolve(PROFILES_DIR, safe)), path.resolve(PROFILES_DIR));
});
