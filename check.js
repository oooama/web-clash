'use strict';
// Static checks for the console. Run with: npm run check
//
// Three kinds of check:
//   1. every JS file parses (CommonJS under server/, ES modules under public/js/)
//   2. every require()/import path resolves
//   3. structural invariants that regressions have broken before
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Strip line and block comments so invariants only match real code. */
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROOT = __dirname;
const failures = [];
const notes = [];
/** Keys of store.state: these must always be reached through `state.`. */
const SHARED_STATE_KEYS = [
    'pg',
    'coreOn',
    'curGroup',
    'pData',
    'allInfo',
    'logs',
    'rules',
    'activePf',
    'editFileName',
    'lastCnHtml',
    'wsRetry',
    'wsTimer'
];

/** Library identifiers that must be bound in-file before use. */
const LIBRARY_IDENTIFIERS = [
    'YAML',
    'WebSocket',
    'express',
    'fs',
    'fsp',
    'path',
    'http',
    'spawn',
    'execFile',
    'execFileSync'
];

/** Browser globals that are always in scope in the front-end modules. */
const BROWSER_GLOBALS = new Set([
    'document', 'window', 'localStorage', 'location', 'history', 'navigator',
    'fetch', 'WebSocket', 'AbortController', 'AbortSignal', 'URL', 'URLSearchParams',
    'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'structuredClone',
    'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'Date', 'RegExp',
    'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Symbol', 'Proxy', 'Reflect', 'Intl', 'BigInt', 'Function',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'Infinity', 'NaN', 'undefined', 'globalThis'
]);

/** Statement keywords that can be followed by '(' and must not be treated as calls. */
const JS_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new',
    'delete', 'void', 'in', 'of', 'do', 'else', 'try', 'finally', 'throw', 'case',
    'break', 'continue', 'function', 'class', 'const', 'let', 'var', 'import',
    'export', 'from', 'as', 'default', 'async', 'yield', 'super', 'this'
]);

/**
 * Reduce a module to its executable identifiers: string, regex and comment
 * contents are dropped, but the `${...}` expressions of template literals are
 * kept, because that is real code (and where a bare state reference hid).
 */
function executableCode(src) {
    const frames = [{ kind: 'code', depth: 0 }];
    let out = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const frame = frames[frames.length - 1];
        if (frame.kind === 'tpl') {
            if (c === '\\') {
                i += 2;
                continue;
            }
            if (c === '`') {
                frames.pop();
                i += 1;
                continue;
            }
            if (c === '$' && src[i + 1] === '{') {
                frames.push({ kind: 'code', depth: 0 });
                out += ' ${';
                i += 2;
                continue;
            }
            // Keep a separator so `return\`x\${f()}\`` cannot collapse into
            // the single identifier `returnf`.
            out += ' ';
            i += 1;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            const nl = src.indexOf('\n', i);
            i = nl < 0 ? src.length : nl;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i);
            i = end < 0 ? src.length : end + 2;
            continue;
        }
        if (c === "'" || c === '"') {
            const quote = c;
            i += 1;
            while (i < src.length) {
                if (src[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (src[i] === quote) {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out += ' ';
            continue;
        }
        if (c === '`') {
            frames.push({ kind: 'tpl' });
            i += 1;
            continue;
        }
        if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(out[out.length - 1] || '')) {
            i += 1;
            while (i < src.length) {
                if (src[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (src[i] === '/' || src[i] === '\n') {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out += ' ';
            continue;
        }
        if (c === '{') {
            frame.depth += 1;
            out += c;
            i += 1;
            continue;
        }
        if (c === '}') {
            if (frame.depth === 0 && frames.length > 1) {
                frames.pop();
                out += '} ';
            } else {
                frame.depth -= 1;
                out += c;
            }
            i += 1;
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}
/**
 * Extract the keys of one i18n dictionary. Uses a brace matcher because the
 * generated file may keep the whole dictionary on a single line.
 */
function dictionaryKeys(src, name) {
    const start = src.indexOf(name + ':');
    if (start < 0) return new Set();
    const open = src.indexOf('{', start);
    let depth = 0;
    let inStr = null;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
        const c = src[i];
        if (inStr) {
            if (c === inStr && src[i - 1] !== '\\') inStr = null;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            inStr = c;
            continue;
        }
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) return new Set();
    const body = src.slice(open + 1, end);
    return new Set([...body.matchAll(/'([a-z]+\.[a-zA-Z0-9]+)'\s*:/g)].map((m) => m[1]));
}

function fail(message) {
    failures.push(message);
    console.error('  FAIL  ' + message);
}

function pass(message) {
    console.log('  ok    ' + message);
}

function walk(dir, filter) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, filter));
        else if (filter(full)) out.push(full);
    }
    return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// --- 1. syntax -------------------------------------------------------------
function checkSyntax() {
    console.log('\n[syntax]');
    const files = [
        path.join(ROOT, 'check.js'),
        path.join(ROOT, 'server.js'),
        ...walk(path.join(ROOT, 'server'), (f) => f.endsWith('.js')),
        ...walk(path.join(ROOT, 'test'), (f) => f.endsWith('.js')),
        ...walk(path.join(ROOT, 'public'), (f) => f.endsWith('.js'))
    ];
    for (const file of files) {
        try {
            execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        } catch (err) {
            const detail = String(err.stderr || err.message).split('\n').slice(0, 4).join(' | ');
            fail(`${rel(file)} does not parse: ${detail}`);
        }
    }
    if (!failures.length) pass(`${files.length} JS files parse`);

    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    // The shell may carry a small pre-paint snippet (theme), but the app code
    // itself must live in modules under public/js/.
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        try {
            new Function(match[1]);
        } catch (err) {
            fail(`public/index.html inline script: ${err.message}`);
        }
    }
    if (!/<script type="module" src="\/js\/main\.js"><\/script>/.test(html)) {
        fail('public/index.html does not load the module entry point /js/main.js');
    } else if (!failures.length) {
        pass('public/index.html: inline snippets parse and the module entry is linked');
    }
}

// --- 2. module resolution --------------------------------------------------
function checkRequires() {
    console.log('\n[modules]');
    const files = [path.join(ROOT, 'server.js'), ...walk(path.join(ROOT, 'server'), (f) => f.endsWith('.js'))];
    let checked = 0;
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
            const spec = match[1];
            checked += 1;
            try {
                require.resolve(spec.startsWith('.') ? path.resolve(path.dirname(file), spec) : spec, { paths: [ROOT] });
            } catch {
                fail(`${rel(file)} requires missing module '${spec}'`);
            }
        }
    }
    if (!failures.length) pass(`${checked} require() paths resolve`);

    const esmFiles = walk(path.join(ROOT, 'public', 'js'), (f) => f.endsWith('.js'));
    if (esmFiles.length) {
        const jsDir = path.join(ROOT, 'public', 'js');
        const pkg = path.join(jsDir, 'package.json');
        if (!fs.existsSync(pkg)) fail('public/js/package.json is required so .js files there are treated as ES modules');
        let imports = 0;
        for (const file of esmFiles) {
            const src = fs.readFileSync(file, 'utf8');
            for (const match of src.matchAll(/from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
                const spec = match[1] || match[2];
                if (!spec.startsWith('.')) continue;
                imports += 1;
                const target = path.resolve(path.dirname(file), spec);
                if (!fs.existsSync(target)) fail(`${rel(file)} imports missing '${spec}'`);
            }
        }
        if (!failures.length) pass(`${imports} ESM import paths resolve`);

        // A missing export is invisible to --check (the file parses fine) but
        // breaks the whole module graph at runtime, so every named import is
        // matched against the target module's actual exports.
        const exportedNames = new Map();
        for (const file of esmFiles) {
            const src = fs.readFileSync(file, 'utf8');
            const names = new Set();
            for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
            for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
            for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.trim().split(/\s+as\s+/).pop().trim();
                    if (name) names.add(name);
                }
            }
            exportedNames.set(path.resolve(file), names);
        }
        let named = 0;
        for (const file of esmFiles) {
            const src = fs.readFileSync(file, 'utf8');
            for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
                const target = path.resolve(path.dirname(file), m[2]);
                if (!fs.existsSync(target)) continue;
                const available = exportedNames.get(target) || new Set();
                for (const part of m[1].split(',')) {
                    const name = part.trim().split(/\s+as\s+/)[0].trim();
                    if (!name) continue;
                    named += 1;
                    if (!available.has(name)) {
                        fail(`${rel(file)} imports '${name}', which ${rel(target)} does not export`);
                    }
                }
            }
        }
        if (!failures.length) pass(`${named} named imports match a real export`);

        // Shared mutable state lives on store.state. A bare reference still
        // parses and still resolves at import time, but throws at runtime the
        // first time that page renders - exactly how the proxies page once
        // silently came up empty.
        const bare = [];
        for (const file of esmFiles) {
            if (path.basename(file) === 'store.js') continue;
            const code = executableCode(fs.readFileSync(file, 'utf8'));
            code.split('\n').forEach((line, index) => {
                for (const key of SHARED_STATE_KEYS) {
                    const re = new RegExp(`(?<![.\\w$])${key}\\b(?!\\s*:)`);
                    if (re.test(line)) bare.push(`${rel(file)}:${index + 1} bare '${key}'`);
                }
            });
        }
        if (bare.length) fail(`bare shared-state references (use state.<key>): ${bare.join(', ')}`);
        else pass('no bare shared-state references');

        // A call to a name that is neither local nor imported only fails when
        // that branch runs. This is how applyPf() kept calling checkSt() (since
        // renamed refreshStatus) and loadPx() after the modules were split.
        const unknownCalls = [];
        for (const file of esmFiles) {
            const code = executableCode(fs.readFileSync(file, 'utf8'));
            const bound = new Set();
            for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
            for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.split(':').pop().trim().split('=')[0].trim();
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
                }
            }
            for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.split(/\s+as\s+/).pop().trim();
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
                }
            }
            for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) bound.add(m[1]);
            for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
                }
            }
            for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[1]);
            for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
            for (const m of code.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
                    if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
                }
            }
            for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
                const name = m[1];
                if (BROWSER_GLOBALS.has(name) || JS_KEYWORDS.has(name) || bound.has(name)) continue;
                unknownCalls.push(`${rel(file)} calls '${name}'`);
            }
        }
        const uniqueCalls = [...new Set(unknownCalls)];
        if (uniqueCalls.length) fail(`calls to unknown names: ${uniqueCalls.join(', ')}`);
        else pass('every bare call resolves to a local or an import');
    } else {
        notes.push('public/js/ not present yet - front-end module checks skipped');
    }
}

// --- 3. structural invariants ---------------------------------------------
function checkInvariants() {
    console.log('\n[invariants]');

    const serverFiles = [path.join(ROOT, 'server.js'), ...walk(path.join(ROOT, 'server'), (f) => f.endsWith('.js'))];
    const serverSrc = serverFiles.map((f) => ({ file: f, src: fs.readFileSync(f, 'utf8') }));

    // Every name exported by any server module, used to spot a sibling helper
    // that is referenced without being imported.
    const exportedNames = new Set();
    for (const { src } of serverSrc) {
        const block = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
        if (!block) continue;
        for (const part of block[1].split(',')) {
            const name = part.split(':')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(name)) exportedNames.add(name);
        }
    }

    // The old stop path killed every mihomo on the machine by image name.
    for (const { file, src } of serverSrc) {
        if (/taskkill\s+\/F\s+\/IM/i.test(stripComments(src))) {
            fail(`${rel(file)} kills processes by image name (taskkill /F /IM)`);
        }
    }
    if (!failures.length) pass('no taskkill-by-image-name in server code');

    // The API and the WebSocket must both be behind the request guard.
    const appSrc = fs.readFileSync(path.join(ROOT, 'server', 'app.js'), 'utf8');
    if (!/app\.use\('\/api',\s*apiGuard\(/.test(appSrc)) fail("server/app.js does not mount apiGuard on '/api'");
    if (!/verifyClient/.test(appSrc) || !/checkUpgrade/.test(appSrc)) fail('server/app.js does not guard the WebSocket upgrade');
    if (!failures.length) pass('apiGuard on /api and checkUpgrade on the WS handshake');

    // State files must go through the atomic writer.
    const nonAtomic = [];
    for (const { file, src } of serverSrc) {
        if (/writeFile\s*\(/.test(src) && !/atomic\.js$/.test(file)) {
            // server/lib/atomic.js is the one place allowed to call writeFile.
            const lines = src.split('\n');
            lines.forEach((line, i) => {
                if (/fsp\.writeFile\(|fs\.writeFile\(/.test(line)) nonAtomic.push(`${rel(file)}:${i + 1}`);
            });
        }
    }
    if (nonAtomic.length) fail(`non-atomic writeFile calls: ${nonAtomic.join(', ')}`);
    else pass('all state writes go through atomic helpers');

    // A module with two top-level module.exports / export statements still
    // parses, but the later one silently wins - which is how a removed helper
    // stayed referenced long after it was deleted.
    const duplicated = [];
    for (const { file, src } of serverSrc) {
        const count = (src.match(/^module\.exports/gm) || []).length;
        if (count > 1) duplicated.push(`${rel(file)} (${count} module.exports)`);
    }
    for (const file of walk(path.join(ROOT, 'public', 'js'), (f) => f.endsWith('.js'))) {
        const src = fs.readFileSync(file, 'utf8');
        const seen = new Set();
        for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
            if (seen.has(m[1])) duplicated.push(`${rel(file)} exports '${m[1]}' twice`);
            seen.add(m[1]);
        }
    }
    if (duplicated.length) fail(`duplicate declarations: ${duplicated.join(', ')}`);
    else pass('no duplicate module exports');

    // Splitting the single-file server into modules can drop a top-level
    // require. That still parses (the identifier is simply unresolved) and only
    // throws when that code path finally runs - exactly how the core-YAML
    // subscription branch lost its `const YAML = require('yaml')`.
    const unbound = [];
    for (const { file, src } of serverSrc) {
        // executableCode strips string/regex literals, so require('fs') does
        // not count as a use of `fs`.
        const code = executableCode(src);
        const bound = new Set();
        // Names pulled in by any require(), including destructuring.
        for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
        for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
            for (const part of m[1].split(',')) {
                const name = part.split(':').pop().trim().split('=')[0].trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
            }
        }
        for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
        for (const name of LIBRARY_IDENTIFIERS) {
            const used = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`).test(code);
            if (used && !bound.has(name)) unbound.push(`${rel(file)} uses '${name}' without binding it`);
        }

        // Sibling-module helpers are the same hazard: a name exported by
        // another module and used here without being destructured out of its
        // require() only fails when that branch runs (how `wrapProxies` and the
        // core-YAML `YAML` import both went missing).
        for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);
        for (const m of code.matchAll(/(?:function\s*[\w$]*\s*|\)\s*=>\s*)\(([^)]*)\)/g)) {
            for (const part of m[1].split(',')) {
                const name = part.split('=')[0].trim().replace(/^\.\.\./, '');
                if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.add(name);
            }
        }
        for (const m of code.matchAll(/\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>/g)) bound.add(m[1]);
        for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[1]);
        for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) bound.add(m[1]);

        for (const name of LIBRARY_IDENTIFIERS) {
            const used = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`).test(code);
            if (used && !bound.has(name)) unbound.push(`${rel(file)} uses '${name}' without binding it`);
        }
        for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:)/g)) {
            const name = m[1];
            if (exportedNames.has(name) && !bound.has(name)) {
                unbound.push(`${rel(file)} uses sibling export '${name}' without importing it`);
            }
        }
    }
    const uniqueUnbound = [...new Set(unbound)];
    if (uniqueUnbound.length) fail(`unbound identifiers: ${uniqueUnbound.join(', ')}`);
    else pass('every used identifier is bound or imported');

    // Every profile route must sanitise its :name parameter.
    const profilesSrc = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'profiles.js'), 'utf8');
    if (!/sanitizeProfileName/.test(profilesSrc)) fail('server/routes/profiles.js does not sanitise profile names');
    else pass('profile routes sanitise names');

    // Front-end: modules must escape interpolated values that reach HTML
    // sinks. Scans the whole public/js tree (pages AND components) and covers
    // innerHTML/outerHTML template-literal assignments plus insertAdjacentHTML
    // calls, not just the pages/ innerHTML pattern.
    const feFiles = walk(path.join(ROOT, 'public', 'js'), (f) => f.endsWith('.js'));
    if (feFiles.length) {
        const raw = [];
        const sinkPatterns = [
            /(?:innerHTML|outerHTML)\s*=\s*`([\s\S]*?)`/g,
            /insertAdjacentHTML\s*\(\s*[^,)]+,\s*`([\s\S]*?)`\s*\)/g
        ];
        for (const file of feFiles) {
            const src = fs.readFileSync(file, 'utf8');
            for (const pattern of sinkPatterns) {
                for (const match of src.matchAll(pattern)) {
                    const template = match[1];
                    for (const expr of template.matchAll(/\$\{([^}]+)\}/g)) {
                        const code = expr[1];
                        if (!/\besc\(|\bescapeHtml\(|\battr\(|\bh\(/.test(code)) {
                            raw.push(`${rel(file)}: ${code.trim().slice(0, 60)}`);
                        }
                    }
                }
            }
        }
        if (raw.length) fail(`unescaped interpolation into HTML sinks: ${raw.join(' | ')}`);
        else pass('no unescaped interpolation into HTML sinks in front-end modules');
    } else {
        notes.push('public/js/ not present yet - XSS interpolation check skipped');
    }

    // i18n dictionaries must stay in sync.
    const i18nPath = path.join(ROOT, 'public', 'js', 'i18n.js');
    if (fs.existsSync(i18nPath)) {
        const src = fs.readFileSync(i18nPath, 'utf8');
        const en = dictionaryKeys(src, 'en');
        const zh = dictionaryKeys(src, 'zh');
        if (!en.size || !zh.size) {
            fail('public/js/i18n.js: could not locate the en/zh dictionaries');
        } else {
            const missingZh = [...en].filter((k) => !zh.has(k));
            const missingEn = [...zh].filter((k) => !en.has(k));
            if (missingZh.length || missingEn.length) {
                fail(`i18n key mismatch: zh missing [${missingZh.join(',')}] en missing [${missingEn.join(',')}]`);
            } else {
                pass(`i18n dictionaries aligned (${en.size} keys)`);
            }
        }
    } else {
        notes.push('public/js/i18n.js not present yet - i18n parity check skipped');
    }

    // Router page ids must resolve to modules.
    const routerPath = path.join(ROOT, 'public', 'js', 'router.js');
    if (fs.existsSync(routerPath)) {
        const src = fs.readFileSync(routerPath, 'utf8');
        const missing = [];
        for (const match of src.matchAll(/import\(\s*'\.\/pages\/([a-z-]+)\.js'\s*\)/g)) {
            if (!fs.existsSync(path.join(ROOT, 'public', 'js', 'pages', `${match[1]}.js`))) missing.push(match[1]);
        }
        if (missing.length) fail(`router references missing page modules: ${missing.join(', ')}`);
        else pass('router page modules all exist');
    } else {
        notes.push('public/js/router.js not present yet - router check skipped');
    }

    // Runtime contract: Node must support global fetch (>= 18).
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (!pkg.engines || !pkg.engines.node) fail('package.json has no engines.node');
    else pass(`engines.node = ${pkg.engines.node}`);

    for (const script of ['start', 'check', 'test']) {
        if (!pkg.scripts || !pkg.scripts[script]) fail(`package.json is missing the "${script}" script`);
    }
}

// --- run -------------------------------------------------------------------
console.log('WebFlClash static checks');
checkSyntax();
checkRequires();
checkInvariants();

console.log('');
for (const note of notes) console.log('  note  ' + note);
if (failures.length) {
    console.error(`\n[check] FAILED with ${failures.length} problem(s)`);
    process.exit(1);
}
console.log('\n[check] all passed');
