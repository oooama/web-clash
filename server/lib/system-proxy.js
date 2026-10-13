'use strict';
// Windows "Internet Settings" system-proxy toggle.
//
// Previously these were exec() shell strings; they are now execFile() calls
// with argument arrays, so nothing is ever parsed by cmd.exe.
const { MIXED_PORT } = require('../constants');
const { run, runQuiet } = require('./exec');

const REG = 'reg.exe';
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
// Standard loopback + RFC1918 bypass list so LAN and local traffic never
// goes through the core (plain Windows wildcards, no range syntax).
const BYPASS = [
    'localhost', '127.*', '10.*', '192.168.*',
    '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*',
    '172.21.*', '172.22.*', '172.23.*', '172.24.*', '172.25.*',
    '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*',
    '<local>'
].join(';');

// INTERNET_OPTION_SETTINGS_CHANGED (39) + INTERNET_OPTION_REFRESH (37):
// tell WinINET the registry changed and have it re-read the settings now,
// so running applications notice without a restart. Sent as an encoded
// command to keep the P/Invoke signature free of quoting issues.
const REFRESH_PS = [
    "Add-Type -Namespace WinINet -Name NM -MemberDefinition '[DllImport(\"wininet.dll\", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);'",
    '[WinINet.NM]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null',
    '[WinINet.NM]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null'
].join('\n');
const REFRESH_PS_B64 = Buffer.from(REFRESH_PS, 'utf16le').toString('base64');

/** Best-effort WinINET change notification; failure here is not fatal. */
async function notifyWinINet() {
    try {
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', REFRESH_PS_B64], { timeout: 10000 });
    } catch {
        // Locked-down or stripped-down systems: registry values are already
        // correct, applications just pick the change up on their next start.
    }
}

/** Enable the system proxy and point it at the mixed port. */
async function enable() {
    await run(REG, ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { timeout: 3000 });
    await run(REG, ['add', KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${MIXED_PORT}`, '/f'], { timeout: 3000 });
    await run(REG, ['add', KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', BYPASS, '/f'], { timeout: 3000 });
    await notifyWinINet();
    return true;
}

/** Disable the system proxy (leaves ProxyServer untouched). */
async function disable() {
    await run(REG, ['add', KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { timeout: 3000 });
    await notifyWinINet();
    return true;
}

/** Current ProxyEnable state; null when the value cannot be read. */
async function isEnabled() {
    const stdout = await runQuiet(REG, ['query', KEY, '/v', 'ProxyEnable'], { timeout: 5000 });
    if (stdout === null) return null;
    return /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout);
}

module.exports = { enable, disable, isEnabled };
