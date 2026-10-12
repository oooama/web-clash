'use strict';
// Windows "Internet Settings" system-proxy toggle.
//
// Previously these were exec() shell strings; they are now execFile() calls
// with argument arrays, so nothing is ever parsed by cmd.exe.
const { MIXED_PORT } = require('../constants');
const { run, runQuiet } = require('./exec');

const REG = 'reg.exe';
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** Enable the system proxy and point it at the mixed port. */
async function enable() {
    await run(REG, ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { timeout: 3000 });
    await run(REG, ['add', KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${MIXED_PORT}`, '/f'], { timeout: 3000 });
    return true;
}

/** Disable the system proxy (leaves ProxyServer untouched). */
async function disable() {
    await run(REG, ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { timeout: 3000 });
    return true;
}

/** Current ProxyEnable state; null when the value cannot be read. */
async function isEnabled() {
    const stdout = await runQuiet(REG, ['query', KEY, '/v', 'ProxyEnable'], { timeout: 5000 });
    if (stdout === null) return null;
    return /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout);
}

module.exports = { enable, disable, isEnabled };
