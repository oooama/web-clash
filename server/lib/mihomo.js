'use strict';
// mihomo core reachability and log streaming.
//
// The previous version only ever called connectLogStream() once, from the
// listen() callback, and only when the core happened to be up already. When
// start.bat launches the console first and the core a few seconds later (the
// normal order), that probe failed and the log page stayed empty for the whole
// session. A watchdog now connects whenever the controller becomes reachable.
const http = require('http');
const { CLASH_API_PORT } = require('../constants');

const LOG_BUFFER_LIMIT = 500;
const WATCHDOG_INTERVAL_MS = 5000;

/** Probe the external controller. A 401 still means mihomo is up. */
async function probeCore() {
    try {
        const res = await fetch(`http://127.0.0.1:${CLASH_API_PORT}/`, {
            signal: AbortSignal.timeout(2000)
        });
        return res.ok || res.status === 401;
    } catch {
        return false;
    }
}

let logBuffer = [];
let logStream = null;
let logRetryTimer = null;
let logRetryDelay = 1000;
let logReconnectEnabled = false;
let watchdogTimer = null;

// Set by the server entry point so this module never needs the WebSocket
// server instance (which would be a circular dependency).
let broadcast = () => {};

function setBroadcaster(fn) {
    broadcast = typeof fn === 'function' ? fn : () => {};
}

function getLogBuffer() {
    return logBuffer;
}
/**
 * Parse one NDJSON log frame from the core and stamp it with a receive time.
 *
 * mihomo sends only {type, payload}. The console renders a timestamp prefix,
 * which therefore always came out as an empty "[]"; the stamp is added here so
 * both /api/logs and the WebSocket stream carry it.
 * Throws on a partial or non-JSON line, which the caller skips.
 */
function parseLogFrame(line) {
    const obj = JSON.parse(line.trim());
    if (!obj.time) obj.time = new Date().toTimeString().slice(0, 8);
    return obj;
}

function connectLogStream() {
    logReconnectEnabled = true;
    if (logRetryTimer) {
        clearTimeout(logRetryTimer);
        logRetryTimer = null;
    }
    if (logStream) {
        try {
            logStream.destroy();
        } catch {
            // Already gone.
        }
        logStream = null;
    }

    logStream = http.get(`http://127.0.0.1:${CLASH_API_PORT}/logs`, (res) => {
        logRetryDelay = 1000;
        let lineBuf = '';
        res.on('data', (chunk) => {
            lineBuf += chunk.toString();
            const lines = lineBuf.split('\n');
            lineBuf = lines.pop();
            for (const line of lines) {
                try {
                    const obj = parseLogFrame(line);
                    logBuffer.push(obj);
                    if (logBuffer.length > LOG_BUFFER_LIMIT) logBuffer.shift();
                    broadcast({ type: 'log', ...obj });
                } catch {
                    // Partial or non-JSON line; skip it.
                }
            }
        });
        res.on('end', scheduleReconnect);
    });

    const scheduleReconnect = () => {
        logStream = null;
        if (!logReconnectEnabled) return;
        if (logRetryTimer) return;
        logRetryTimer = setTimeout(() => {
            if (!logReconnectEnabled) return;
            logRetryTimer = null;
            logRetryDelay = Math.min(logRetryDelay * 2, 30000);
            connectLogStream();
        }, logRetryDelay);
    };

    logStream.on('error', scheduleReconnect);
    logStream.on('close', scheduleReconnect);
}

/** True when a log stream is currently attached. */
function isLogStreamConnected() {
    return !!logStream && !logStream.destroyed;
}

/**
 * Connect only if we are not already streaming and the core answers.
 * Safe to call repeatedly; used by the watchdog.
 */
async function ensureLogStream() {
    if (logReconnectEnabled && isLogStreamConnected()) return false;
    if (!(await probeCore())) return false;
    connectLogStream();
    return true;
}

/** Poll until the core is reachable, then attach the log stream. */
function startLogWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        ensureLogStream().catch(() => {});
    }, WATCHDOG_INTERVAL_MS);
    if (watchdogTimer.unref) watchdogTimer.unref();
}

function stopLogWatchdog() {
    if (!watchdogTimer) return;
    clearInterval(watchdogTimer);
    watchdogTimer = null;
}

function disconnectLogStream() {
    logReconnectEnabled = false;
    if (logRetryTimer) {
        clearTimeout(logRetryTimer);
        logRetryTimer = null;
    }
    logRetryDelay = 1000;
    if (logStream) {
        try {
            logStream.destroy();
        } catch {
            // Already gone.
        }
        logStream = null;
    }
    logBuffer = [];
}

module.exports = {
    probeCore,
    connectLogStream,
    disconnectLogStream,
    ensureLogStream,
    isLogStreamConnected,
    startLogWatchdog,
    stopLogWatchdog,
    getLogBuffer,
    parseLogFrame,
    setBroadcaster,
    LOG_BUFFER_LIMIT
};
