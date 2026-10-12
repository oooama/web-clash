'use strict';
// Atomic file writes plus a per-path serialisation queue.
//
// Every state file this server owns (config.yaml, profile-meta.json, profiles)
// used to be written with a plain fsp.writeFile, so a crash mid-write could
// leave a truncated YAML/JSON file behind, and two server processes could
// interleave read-modify-write cycles on profile-meta.json.
const fs = require('fs');
const fsp = fs.promises;

/** Resolve a path to its real target so two spellings share one queue. */
function queueKey(file) {
    return process.platform === 'win32' ? file.toLowerCase() : file;
}

const queues = new Map();

/**
 * Run `task` after any previously queued task for the same path settles.
 * Rejections do not poison the queue for later callers.
 */
function serialized(file, task) {
    const key = queueKey(file);
    const previous = queues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(key, next.catch(() => {}));
    return next;
}

/** Write `data` to `file` via a sibling temp file and an atomic rename. */
async function writeFileAtomic(file, data) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    await fsp.writeFile(tmp, data);
    try {
        await fsp.rename(tmp, file);
    } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        throw err;
    }
}

/** Serialised atomic write. */
function writeFileQueued(file, data) {
    return serialized(file, () => writeFileAtomic(file, data));
}

module.exports = { serialized, writeFileAtomic, writeFileQueued };
