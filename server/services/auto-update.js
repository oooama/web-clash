'use strict';
// Periodic subscription refresh.
const fs = require('fs');
const path = require('path');
const { PROFILES_DIR } = require('../constants');
const { loadMeta, updateMeta, applySubscriptionInfo } = require('../lib/meta');
const { writeFileAtomic } = require('../lib/atomic');
const { fetchAndConvertSub } = require('../lib/subscription');
const { hasSubscriptionInfo } = require('../lib/subscription-info');

const INTERVAL_MS = 60000;

/** Refresh every profile whose interval has elapsed. */
async function autoUpdateSubs() {
    try {
        const metaSnapshot = await loadMeta();
        const now = Date.now();
        for (const [fileName, info] of Object.entries(metaSnapshot)) {
            if (!info || !info.url || !info.interval || info.interval <= 0) continue;
            const lastMs = info.lastUpdate || 0;
            if (now - lastMs < info.interval * 60 * 1000) continue;
            const filePath = path.join(PROFILES_DIR, fileName);
            if (!fs.existsSync(filePath)) continue;
            try {
                const result = await fetchAndConvertSub(info.url);
                if (result.error) continue;
                await writeFileAtomic(filePath, result.yamlContent);
                await updateMeta((meta) => {
                    if (!meta[fileName]) meta[fileName] = {};
                    meta[fileName].lastUpdate = now;
                    if (hasSubscriptionInfo(result.subInfo)) applySubscriptionInfo(meta[fileName], result.subInfo);
                });
                console.log(`[auto-update] ${fileName} updated`);
            } catch (err) {
                console.log(`[auto-update] ${fileName} failed: ${err.message}`);
            }
        }
    } catch (err) {
        console.error('[auto-update] sweep failed:', err.message);
    }
}

/** Start the refresh timer. Unref'd so it never holds the process open. */
function startAutoUpdate() {
    const timer = setInterval(() => {
        autoUpdateSubs().catch(() => {});
    }, INTERVAL_MS);
    if (timer.unref) timer.unref();
    return timer;
}

module.exports = { autoUpdateSubs, startAutoUpdate, INTERVAL_MS };
