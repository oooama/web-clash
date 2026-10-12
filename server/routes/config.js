'use strict';
// Config file access and rule editing.
const express = require('express');
const { readConfig, writeConfig, defaultConfig } = require('../lib/config');

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

module.exports = router;
