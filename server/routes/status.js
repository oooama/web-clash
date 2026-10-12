'use strict';
// Core status and lifecycle endpoints.
const express = require('express');
const { MIXED_PORT, CLASH_API_PORT } = require('../constants');
const core = require('../lib/core');
const { connectLogStream, disconnectLogStream } = require('../lib/mihomo');

const router = express.Router();

let coreStartedAt = null;
let coreWasRunning = false;

router.get('/status', async (req, res) => {
    const status = await core.getStatus();
    if (status.running && !coreWasRunning) coreStartedAt = Date.now();
    if (!status.running) coreStartedAt = null;
    coreWasRunning = status.running;
    res.json({
        running: status.running,
        ports: { mixed: MIXED_PORT, api: CLASH_API_PORT },
        uptime: coreStartedAt ? Math.floor((Date.now() - coreStartedAt) / 1000) : 0,
        memory: status.running ? status.memory : 0,
        pid: status.pid,
        processCount: status.processCount
    });
});

router.post('/start', async (req, res) => {
    const result = await core.start();
    if (result.started) {
        console.log('[start] mihomo started, pid:', result.pid);
        setTimeout(connectLogStream, 2000);
    } else if (result.alreadyRunning) {
        console.log('[start] mihomo already running, not spawning a second core');
        connectLogStream();
    } else {
        console.error('[start] failed:', result.error);
    }
    res.json({ success: !result.error, ...result });
});

router.post('/stop', async (req, res) => {
    disconnectLogStream();
    const result = await core.stop();
    if (result.stopped) console.log('[stop] mihomo stopped, pid:', result.pid);
    else console.log('[stop] nothing to stop:', result.reason);
    res.json({ success: true, ...result });
});

module.exports = router;
