'use strict';
// profile-meta.json access. All mutations go through updateMeta() so that
// concurrent requests (and the auto-update timer) cannot interleave.
const fs = require('fs');
const fsp = fs.promises;
const { PROFILE_META } = require('../constants');
const { serialized, writeFileAtomic } = require('./atomic');

async function loadMeta() {
    try {
        return JSON.parse(await fsp.readFile(PROFILE_META, 'utf8'));
    } catch {
        return {};
    }
}

async function saveMeta(meta) {
    await writeFileAtomic(PROFILE_META, JSON.stringify(meta, null, 2));
}

/**
 * Read-modify-write profile-meta.json under a per-path queue.
 * `mutator` receives the parsed object and may return any value, which is
 * forwarded to the caller.
 */
function updateMeta(mutator) {
    return serialized(PROFILE_META, async () => {
        const meta = await loadMeta();
        const result = await mutator(meta);
        await saveMeta(meta);
        return result;
    });
}

/** Subscription counters shared by add/update/auto-update paths. */
function applySubscriptionInfo(target, info) {
    if (!info) return;
    if (info.upload !== undefined) target.upload = info.upload || 0;
    if (info.download !== undefined) target.download = info.download || 0;
    if (info.total !== undefined) target.total = info.total || 0;
    if (info.expire !== undefined) target.expire = info.expire || 0;
}

module.exports = { loadMeta, saveMeta, updateMeta, applySubscriptionInfo };
