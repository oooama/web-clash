'use strict';
// Lifecycle tests for server/lib/core.js that can run without a real mihomo
// binary. They cover the stop() branches the project fixed after real
// incidents (killing unrelated processes, refusing to stop when in doubt):
//
//   * a recorded PID whose process is not a core  -> refuse, clear the PID
//     file, and never touch the unrelated process
//   * no PID file and no core process at all      -> refuse (no-recorded-pid)
//   * readPid round-trip and garbage tolerance
//
// When a real mihomo-run.exe is running on this machine the tests skip:
// the process sample would see it and the assertions would not hold.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const core = require('../server/lib/core');
const { CORE_PID_FILE } = require('../server/constants');

/** A real, live process whose image name is NOT mihomo-run.exe. */
function spawnDecoy() {
    return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

function pidFileExists() {
    try {
        fs.accessSync(CORE_PID_FILE);
        return true;
    } catch {
        return false;
    }
}

function removePidFile() {
    try {
        fs.unlinkSync(CORE_PID_FILE);
    } catch {
        // Already gone.
    }
}

test('stop() refuses a recorded PID whose process is not the core', async (t) => {
    const procs = await core.sampleProcesses(true);
    if (procs.length) return t.skip('a real mihomo-run.exe is running; skipped to avoid touching it');

    const decoy = spawnDecoy();
    try {
        fs.writeFileSync(CORE_PID_FILE, String(decoy.pid));
        const result = await core.stop();
        assert.deepStrictEqual(result, { stopped: false, reason: 'recorded-pid-not-running' });
        // The decoy must still be alive: stop() never kills a non-core image.
        assert.doesNotThrow(() => process.kill(decoy.pid, 0), 'the unrelated process must survive');
        assert.strictEqual(pidFileExists(), false, 'the stale PID file is cleaned up');
    } finally {
        decoy.kill();
        removePidFile();
    }
});

test('stop() with no PID file and no core answers no-recorded-pid', async (t) => {
    const procs = await core.sampleProcesses(true);
    if (procs.length) return t.skip('a real mihomo-run.exe is running; skipped to avoid touching it');

    removePidFile();
    const result = await core.stop();
    assert.deepStrictEqual(result, { stopped: false, reason: 'no-recorded-pid' });
    assert.strictEqual(pidFileExists(), false);
});

test('readPid parses the PID file and tolerates garbage', async (t) => {
    const procs = await core.sampleProcesses(true);
    if (procs.length) return t.skip('a real mihomo-run.exe is running; skipped to avoid touching it');

    try {
        fs.writeFileSync(CORE_PID_FILE, '424242');
        assert.strictEqual(await core.readPid(), 424242);

        fs.writeFileSync(CORE_PID_FILE, 'not-a-pid');
        assert.strictEqual(await core.readPid(), null);
    } finally {
        removePidFile();
    }
});
