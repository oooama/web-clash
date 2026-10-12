'use strict';
// Promise wrappers around the Windows CLI helpers this server shells out to.
//
// These are the only places that spawn a shell. They always pass an explicit
// timeout, always run without a shell where possible, and never interpolate
// untrusted input into the command string.
const { execFile } = require('child_process');

/**
 * Run an executable and resolve with its stdout.
 * Rejects on a non-zero exit or timeout, so callers can distinguish
 * "command failed" from "command returned nothing".
 */
function run(file, args, { timeout = 5000 } = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout);
        });
    });
}

/** Run an executable, resolving null instead of rejecting on failure. */
async function runQuiet(file, args, options) {
    try {
        return await run(file, args, options);
    } catch {
        return null;
    }
}

module.exports = { run, runQuiet };
