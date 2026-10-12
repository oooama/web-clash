'use strict';
// Application wiring: middleware, route mounting, WebSocket server.
//
// Kept separate from the entry point so tests can build the app without
// binding a port.
const express = require('express');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const { PORT, PUBLIC_DIR, DATA_DIR, PROFILES_DIR, CLASH_API_PORT } = require('./constants');
const { apiGuard, checkUpgrade, REQUEST_HEADER } = require('./lib/security');
const { setBroadcaster } = require('./lib/mihomo');

const statusRouter = require('./routes/status');
const systemRouter = require('./routes/system');
const logsRouter = require('./routes/logs');
const configRouter = require('./routes/config');
const profilesRouter = require('./routes/profiles');

/**
 * Forward anything under /api that no local route claimed to the mihomo
 * external controller. This replaces the old SKIP_ROUTES string list, which
 * had to be kept in sync by hand and silently shadowed new local routes.
 */
async function proxyToCore(req, res) {
    try {
        const headers = { ...req.headers, host: `127.0.0.1:${CLASH_API_PORT}` };
        delete headers['content-length'];
        delete headers[REQUEST_HEADER];

        const options = { method: req.method, headers, signal: AbortSignal.timeout(3000) };
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
            options.body = JSON.stringify(req.body);
        }

        const coreResp = await fetch(`http://127.0.0.1:${CLASH_API_PORT}${req.url}`, options);
        const text = await coreResp.text();
        let body = text;
        try {
            const json = JSON.parse(text);
            if (json.proxies && !Array.isArray(json.proxies) && req.path === '/proxies') {
                body = JSON.stringify(json.proxies);
            }
        } catch {
            // Non-JSON core response; pass it through untouched.
        }
        if (!res.headersSent) {
            res.setHeader('content-type', 'application/json');
            res.status(coreResp.status).send(body);
        }
    } catch {
        if (!res.headersSent) res.status(502).json({ error: 'mihomo core not running' });
    }
}

function createApp({ onReject, onError } = {}) {
    const app = express();
    const server = http.createServer(app);

    // Report a fatal server error exactly once, whoever saw it first.
    let errorReported = false;
    const reportError = (err) => {
        if (errorReported) return;
        errorReported = true;
        if (onError) onError(err);
    };

    const wss = new WebSocket.Server({
        server,
        verifyClient: (info, done) => {
            const reason = checkUpgrade(info.req);
            if (reason) {
                if (onReject) onReject(reason, info.req);
                done(false, 403, 'Forbidden');
                return;
            }
            done(true);
        }
    });

    // ws re-emits the HTTP server's 'error' event on itself. An EventEmitter
    // with no 'error' listener throws, which would surface as an
    // uncaughtException and skip the caller's handler entirely - so both
    // objects route into the same reporter.
    server.on('error', reportError);
    wss.on('error', reportError);

    setBroadcaster((message) => {
        const payload = JSON.stringify(message);
        for (const client of wss.clients) {
            if (client.readyState === 1) client.send(payload);
        }
    });

    wss.on('connection', (ws) => {
        console.log('[ws] client connected');
        ws.on('close', () => console.log('[ws] client disconnected'));
    });

    app.use(express.static(PUBLIC_DIR));
    app.use(express.json({ limit: '8mb' }));

    app.use('/api', apiGuard(onReject));
    app.use('/api', statusRouter);
    app.use('/api', systemRouter);
    app.use('/api', logsRouter);
    app.use('/api', configRouter);
    app.use('/api', profilesRouter);
    app.use('/api', proxyToCore);

    // History-API fallback: any other GET renders the shell so that a deep
    // link such as /profiles works on a hard refresh.
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) {
            res.status(404).json({ success: false, error: 'Not found' });
            return;
        }
        res.sendFile('index.html', { root: PUBLIC_DIR }, (err) => {
            if (err && !res.headersSent) res.status(500).send('index.html not found');
        });
    });

    return { app, server, wss };
}

/** Create the working directories the server expects. */
function ensureDirectories() {
    for (const dir of [DATA_DIR, PROFILES_DIR]) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
}

module.exports = { createApp, proxyToCore, ensureDirectories, PORT };
