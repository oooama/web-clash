'use strict';
// Profile (subscription) management: list, add, delete, update, apply, edit.
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const YAML = require('yaml');
const { PROFILES_DIR, MIXED_PORT, CLASH_API_PORT } = require('../constants');
const { sanitizeProfileName } = require('../lib/paths');
const { loadMeta, updateMeta, applySubscriptionInfo } = require('../lib/meta');
const { writeFileAtomic } = require('../lib/atomic');
const { fetchAndConvertSub } = require('../lib/subscription');
const { hasSubscriptionInfo } = require('../lib/subscription-info');
const { defaultConfig, readConfig, writeConfig } = require('../lib/config');
const { loadIntranet, applyIntranetToConfig } = require('../lib/intranet');
const core = require('../lib/core');
const { connectLogStream, disconnectLogStream } = require('../lib/mihomo');

const router = express.Router();

/** Resolve a route parameter to a confined profile filename. */
function resolveName(raw) {
    return sanitizeProfileName(decodeURIComponent(raw || ''));
}

function invalidName(res) {
    return res.json({ success: false, error: 'Invalid profile name' });
}

router.get('/profiles', async (req, res) => {
    try {
        const meta = await loadMeta();
        const files = (await fsp.readdir(PROFILES_DIR)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
        const profiles = await Promise.all(
            files.map(async (f) => {
                const filePath = path.join(PROFILES_DIR, f);
                const [content, stat] = await Promise.all([fsp.readFile(filePath, 'utf8'), fsp.stat(filePath)]);
                const info = meta[f] || {};
                let nodeCount = 0;
                try {
                    const parsed = YAML.parse(content);
                    if (Array.isArray(parsed && parsed.proxies)) nodeCount = parsed.proxies.length;
                } catch {
                    // Unparseable profile still lists, with nodeCount 0.
                }
                return {
                    name: f,
                    displayName: info.displayName || f.replace(/\.yaml$|\.yml$/, ''),
                    nodeCount,
                    size: Buffer.byteLength(content),
                    modified: stat.mtime,
                    url: info.url || null,
                    aggregate: info.aggregate || false,
                    interval: info.interval || 0,
                    lastUpdate: info.lastUpdate || null,
                    upload: info.upload || 0,
                    download: info.download || 0,
                    total: info.total || 0,
                    expire: info.expire || 0
                };
            })
        );
        res.json({ success: true, profiles, active: meta._active || '' });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/profiles', async (req, res) => {
    try {
        let { name, content, url } = req.body || {};
        const userProvidedName = !!name;
        let subInfo = {};
        if (url) {
            const result = await fetchAndConvertSub(url);
            if (result.error) return res.json({ success: false, error: result.error });
            content = result.yamlContent;
            subInfo = result.subInfo;
            if (!name) name = 'sub_' + Date.now();
        }
        if (!name || !content) return res.json({ success: false, error: 'name and content required' });
        const safeName = sanitizeProfileName(name);
        if (!safeName) return invalidName(res);
        await writeFileAtomic(path.join(PROFILES_DIR, safeName), content);
        await updateMeta((meta) => {
            meta[safeName] = meta[safeName] || {};
            if (url) meta[safeName].url = url;
            if (userProvidedName && name) meta[safeName].displayName = name;
            if (url && hasSubscriptionInfo(subInfo)) applySubscriptionInfo(meta[safeName], subInfo);
            meta[safeName].lastUpdate = Date.now();
        });
        res.json({ success: true, name: safeName });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.delete('/profiles/:name', async (req, res) => {
    try {
        const safeName = resolveName(req.params.name);
        if (!safeName) return invalidName(res);
        const filePath = path.join(PROFILES_DIR, safeName);
        if (fs.existsSync(filePath)) await fsp.unlink(filePath);
        const wasActive = await updateMeta((meta) => {
            const active = meta._active === safeName;
            delete meta[safeName];
            if (active) meta._active = '';
            return active;
        });
        if (wasActive) await writeConfig(defaultConfig());
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/profiles/:name/update', async (req, res) => {
    try {
        const safeName = resolveName(req.params.name);
        if (!safeName) return invalidName(res);
        const meta = await loadMeta();
        const url = meta[safeName] && meta[safeName].url;
        if (!url) return res.json({ success: false, error: 'No subscription URL' });

        const result = await fetchAndConvertSub(url);
        if (result.error) return res.json({ success: false, error: result.error });

        await writeFileAtomic(path.join(PROFILES_DIR, safeName), result.yamlContent);
        await updateMeta((m) => {
            if (!m[safeName]) m[safeName] = {};
            if (hasSubscriptionInfo(result.subInfo)) applySubscriptionInfo(m[safeName], result.subInfo);
            m[safeName].lastUpdate = Date.now();
        });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.post('/profiles/:name/apply', async (req, res) => {
    try {
        const fileName = resolveName(req.params.name);
        if (!fileName) return invalidName(res);
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });

        let profile;
        try {
            profile = YAML.parse(await fsp.readFile(filePath, 'utf8'));
            if (!profile || typeof profile !== 'object') throw new Error('invalid YAML');
        } catch (err) {
            return res.json({ success: false, error: '配置文件无效，请重新订阅: ' + err.message });
        }

        // Start from the existing config so user tweaks (ports, dns, sniffer)
        // survive an apply; fall back to the full default shape when there is
        // no usable config yet.
        const base = (await readConfig()) || defaultConfig();
        base['mixed-port'] = base['mixed-port'] || MIXED_PORT;
        base['external-controller'] = base['external-controller'] || `127.0.0.1:${CLASH_API_PORT}`;
        base['geodata-mode'] = true;
        base['geodata-loader'] = 'standard';
        base.proxies = profile.proxies || [];
        base['proxy-groups'] = profile['proxy-groups'] || [];
        base.rules = profile.rules || [];

        // Corporate hosts can resolve to private IPs; without these rules the
        // profile's own MATCH sends intranet traffic to a remote node, which
        // cannot reach it. See server/lib/intranet.js.
        applyIntranetToConfig(base, await loadIntranet());

        await writeConfig(base);
        await updateMeta((meta) => {
            meta._active = fileName;
        });

        disconnectLogStream();
        const restarted = await core.restart();
        if (restarted.started) setTimeout(connectLogStream, 2000);
        else connectLogStream();

        res.json({
            success: true,
            message: 'Applied. Restarting mihomo core...',
            core: restarted
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.put('/profiles/:name/content', async (req, res) => {
    try {
        const fileName = resolveName(req.params.name);
        if (!fileName) return invalidName(res);
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });
        const { content } = req.body || {};
        if (!content) return res.json({ success: false, error: 'content required' });
        await writeFileAtomic(filePath, content);
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.put('/profiles/:name/meta', async (req, res) => {
    try {
        const fileName = resolveName(req.params.name);
        if (!fileName) return invalidName(res);
        const filePath = path.join(PROFILES_DIR, fileName);
        if (!fs.existsSync(filePath)) return res.json({ success: false, error: 'not found' });
        const { url, interval, displayName } = req.body || {};
        await updateMeta((meta) => {
            if (!meta[fileName]) meta[fileName] = {};
            if (url !== undefined) meta[fileName].url = url || null;
            if (interval !== undefined) meta[fileName].interval = parseInt(interval, 10) || 0;
            if (displayName !== undefined) meta[fileName].displayName = displayName || null;
        });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

module.exports = router;
