'use strict';
// Windows system-proxy toggle and external-IP lookup.
const express = require('express');
const http = require('http');
const { MIXED_PORT } = require('../constants');
const systemProxy = require('../lib/system-proxy');

const router = express.Router();

router.post('/system-proxy', async (req, res) => {
    try {
        if (req.body && req.body.enable) await systemProxy.enable();
        else await systemProxy.disable();
        res.json({ success: true, enabled: !!(req.body && req.body.enable) });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

router.get('/system-proxy', async (req, res) => {
    const enabled = await systemProxy.isEnabled();
    res.json({ enabled: enabled === true });
});

// --- external IP -----------------------------------------------------------
// The dashboard shows an "External IP" row. Resolving it means one request to
// a third-party echo service *through the proxy*, so the result is cached for
// five minutes and failures are reported as null instead of throwing.
const EXT_IP_TTL_MS = 5 * 60 * 1000;
const EXT_IP_URL = 'http://ip-api.com/json/?fields=query';
let extIpCache = { at: 0, ip: null };

function fetchExternalIp() {
    return new Promise((resolve) => {
        const target = new URL(EXT_IP_URL);
        const req = http.request(
            {
                host: '127.0.0.1',
                port: MIXED_PORT,
                method: 'GET',
                path: EXT_IP_URL,
                headers: { Host: target.host, Accept: 'application/json' },
                timeout: 8000
            },
            (resp) => {
                let body = '';
                resp.setEncoding('utf8');
                resp.on('data', (chunk) => {
                    body += chunk;
                    if (body.length > 8192) req.destroy();
                });
                resp.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(typeof parsed.query === 'string' ? parsed.query : null);
                    } catch {
                        resolve(null);
                    }
                });
            }
        );
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
        req.end();
    });
}

router.get('/ext-ip', async (req, res) => {
    const fresh = Date.now() - extIpCache.at < EXT_IP_TTL_MS;
    if (fresh) return res.json({ ip: extIpCache.ip, cached: true });
    const ip = await fetchExternalIp();
    if (ip) extIpCache = { at: Date.now(), ip };
    res.json({ ip, cached: false });
});

module.exports = router;
