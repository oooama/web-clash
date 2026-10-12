'use strict';
// Log buffer read-out and the traffic sampling endpoint.
const express = require('express');
const http = require('http');
const { CLASH_API_PORT } = require('../constants');
const { getLogBuffer } = require('../lib/mihomo');

const router = express.Router();

router.get('/logs', (req, res) => {
    res.json(getLogBuffer().slice(-200));
});

/**
 * Sample mihomo's /traffic stream for 1.5s and return the parsed frames.
 *
 * The previous implementation had two competing response paths: a 1500ms timer
 * that sent the parsed frames, and an `end` handler that sent an empty array.
 * Whichever fired first won, so buffered frames were silently dropped whenever
 * the stream closed early. All paths now funnel through one `finish()`.
 */
router.get('/traffic', (req, res) => {
    let buf = '';
    let done = false;

    const parse = () => {
        const items = [];
        for (const line of buf.split('\n')) {
            try {
                const obj = JSON.parse(line.trim());
                items.push(obj);
            } catch {
                // Partial or non-JSON frame; ignore it.
            }
        }
        return items;
    };

    const finish = (items) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!res.headersSent) res.json(items);
    };

    const req2 = http.get(`http://127.0.0.1:${CLASH_API_PORT}/traffic`, (res2) => {
        res2.on('data', (chunk) => {
            buf += chunk;
        });
        res2.on('end', () => finish(parse()));
        res2.on('error', () => finish(parse()));
    });

    const timer = setTimeout(() => {
        req2.destroy();
        finish(parse());
    }, 1500);

    req2.on('error', () => finish([]));
    req2.setTimeout(2000, () => {
        req2.destroy();
        finish(parse());
    });
});

module.exports = router;
