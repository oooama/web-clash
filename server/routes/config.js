'use strict';
// Config file access and rule editing.
const express = require('express');
const { readConfig, writeConfig, defaultConfig, withMode } = require('../lib/config');
const { CLASH_API_PORT } = require('../constants');

const router = express.Router();

router.get('/config', async (req, res) => {
    try {
        res.json({ success: true, config: (await readConfig()) || null });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/config', async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object') {
            return res.json({ success: false, error: 'config object required' });
        }
        await writeConfig(req.body);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.get('/rules', async (req, res) => {
    try {
        const config = await readConfig();
        res.json({ rules: (config && config.rules) || [] });
    } catch (err) {
        res.json({ rules: [], error: err.message });
    }
});

router.put('/rules', async (req, res) => {
    try {
        const config = (await readConfig()) || defaultConfig();
        config.rules = (req.body && req.body.rules) || [];
        await writeConfig(config);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});
/**
 * Switch the outbound mode.
 *
 * The core's own PATCH /configs only changes the running process, so the choice
 * used to be lost on every restart. This writes the file first, then applies the
 * mode to the core; an unreachable core still leaves the file updated.
 */
router.post('/mode', async (req, res) => {
    try {
        const next = withMode((await readConfig()) || defaultConfig(), req.body && req.body.mode);
        if (!next) {
            return res.json({ success: false, error: 'mode must be rule, global or direct' });
        }
        await writeConfig(next);
        let applied = false;
        try {
            const resp = await fetch(`http://127.0.0.1:${CLASH_API_PORT}/configs`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ mode: next.mode }),
                signal: AbortSignal.timeout(3000)
            });
            applied = resp.ok;
        } catch {
            // Core not running: the file is updated and it applies on next start.
        }
        res.json({ success: true, mode: next.mode, applied });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
