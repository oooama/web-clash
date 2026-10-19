'use strict';
// Free-aggregate endpoints: inspect sources/status and trigger a refresh.
const express = require('express');
const path = require('path');
const { DATA_DIR } = require('../constants');
const freeSources = require('../lib/free-sources');
const { loadMeta } = require('../lib/meta');

const router = express.Router();
const SOURCES_PATH = path.join(DATA_DIR, 'free-sources.json');

router.get('/free-sources', async (req, res) => {
    try {
        const sources = await freeSources.loadFreeSources(SOURCES_PATH);
        const meta = await loadMeta();
        const info = meta[freeSources.FREE_AGGREGATE_FILE] || {};
        res.json({
            success: true,
            running: freeSources.isRunning(),
            sources,
            lastRun: info.lastRun || null,
            interval: info.interval || 0,
            lastUpdate: info.lastUpdate || null
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/free-sources/refresh', async (req, res) => {
    try {
        if (freeSources.isRunning()) {
            return res.json({ success: true, started: false, busy: true });
        }
        // Fire and forget: aggregation plus probing can take a minute or
        // more, so the client polls GET /free-sources for progress instead.
        freeSources.refreshFreeAggregate().catch(() => {});
        res.json({ success: true, started: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
