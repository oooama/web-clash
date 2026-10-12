'use strict';
// WebFlClash / ProxyNexus console entry point.
//
// The application used to live in this single 912-line file. It is now split
// by domain under server/ (see README.md). This file only wires up the
// process: directories, the app, timers, listening, and fatal-error handling.
const fsp = require('fs').promises;
const { PROFILES_DIR, PORT, MIXED_PORT, CLASH_API_PORT } = require('./server/constants');
const { createApp, ensureDirectories } = require('./server/app');
const { loadMeta } = require('./server/lib/meta');
const { writeConfig, defaultConfig } = require('./server/lib/config');
const { probeCore, startLogWatchdog, stopLogWatchdog, ensureLogStream } = require('./server/lib/mihomo');
const { startAutoUpdate } = require('./server/services/auto-update');

function logRejected(reason, req) {
    console.warn(`[security] rejected ${req.method} ${req.url} from ${req.socket.remoteAddress || '?'} (${reason})`);
}

ensureDirectories();
const { server } = createApp({ onReject: logRejected, onError: handleServerError });

// Reset the config when there is nothing to run yet, so a fresh checkout still
// produces a bootable config.yaml for the core.
async function bootstrapConfig() {
    try {
        const profiles = (await fsp.readdir(PROFILES_DIR)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
        const meta = await loadMeta();
        if (profiles.length === 0 && !meta._active) {
            await writeConfig(defaultConfig());
            console.log('  Reset config: no profiles found');
        }
    } catch (err) {
        console.error('[boot] config bootstrap failed:', err.message);
    }
}

function handleServerError(err) {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n  [FATAL] Port ${PORT} is already in use.`);
        console.error('  Another console instance is probably still running.');
        console.error(`  Run stop.bat, or close the process listening on ${PORT}, then start again.\n`);
    } else {
        console.error('[FATAL] server error:', err.message);
    }
    process.exit(1);
}

server.listen(PORT, '127.0.0.1', async () => {
    await bootstrapConfig();
    console.log(`\n  WebFlClash running at http://127.0.0.1:${PORT}\n`);
    console.log(`  Proxy:   http://127.0.0.1:${MIXED_PORT}`);
    console.log(`  API:     http://127.0.0.1:${CLASH_API_PORT}`);
    console.log(`\n  Start mihomo core first, then use this web UI to manage it.\n`);

    startLogWatchdog();
    if (await probeCore()) await ensureLogStream();
});

startAutoUpdate();

let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopLogWatchdog();
    server.close(() => process.exit(0));
    // Do not hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(0), 2000).unref();
    if (signal) console.log(`[${signal}] shutting down`);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A crashed server must not keep its timers running in the background: that is
// how the previous version ended up with orphaned processes holding a stale
// copy of profile-meta.json.
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err.message, err.stack);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason);
    process.exit(1);
});
