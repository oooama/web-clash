// Smoke check: server.js must parse, and the inline <script> in
// public/index.html must parse without duplicate declarations.
// Run: npm run check
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = __dirname;

execFileSync(process.execPath, ['--check', path.join(root, 'server.js')], { stdio: 'inherit' });
console.log('[check] server.js parses OK');

const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
    console.error('[check] FAIL: no inline <script> found in public/index.html');
    process.exit(1);
}
try {
    new Function(m[1]);
    console.log('[check] inline script parses OK');
} catch (e) {
    console.error('[check] FAIL: inline script syntax error:', e.message);
    process.exit(1);
}

console.log('[check] all passed');
