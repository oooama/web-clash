'use strict';
// mihomo process lifecycle.
//
// Two defects in the previous single-file server are fixed here:
//   * /api/start spawned a new core unconditionally, so calling it twice left
//     orphaned processes behind (observed in practice: two mihomo-run.exe and
//     two node.exe, only one of each holding the listening ports).
//   * /api/stop ran `taskkill /F /IM mihomo-run.exe`, which kills every core
//     on the machine, including ones started by other tools.
//
// Instead we record the PID we spawned in data/core.pid, verify the process
// really is mihomo-run.exe before killing it, and refuse to start a second
// core when one is already answering on the external controller.
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const { MIHOMO_RUN, DATA_DIR, CONFIG_PATH, CORE_PID_FILE } = require('../constants');
const { runQuiet } = require('./exec');
const { writeFileAtomic } = require('./atomic');
const { probeCore } = require('./mihomo');

const PROCESS_NAME = 'mihomo-run.exe';
const SAMPLE_TTL_MS = 10000;

let sample = { at: 0, processes: [] };

/** All running mihomo processes with their working-set size in bytes. */
async function sampleProcesses(force = false) {
    if (!force && Date.now() - sample.at < SAMPLE_TTL_MS) return sample.processes;
    const stdout = await runQuiet('tasklist.exe', ['/FI', `IMAGENAME eq ${PROCESS_NAME}`, '/FO', 'CSV', '/NH'], { timeout: 4000 });
    const processes = [];
    if (stdout) {
        for (const line of stdout.split(/\r?\n/)) {
            const cols = line.match(/"([^"]*)"/g);
            if (!cols || cols.length < 5) continue;
            const pid = Number(cols[1].replace(/"/g, ''));
            const memory = Number(cols[4].replace(/[^0-9]/g, '')) * 1024;
            if (Number.isFinite(pid) && pid > 0) processes.push({ pid, memory: memory || 0 });
        }
    }
    sample = { at: Date.now(), processes };
    return processes;
}

/** Invalidate the cached process sample (call after start/stop). */
function invalidateSample() {
    sample = { at: 0, processes: [] };
}

async function readPid() {
    try {
        const raw = (await fsp.readFile(CORE_PID_FILE, 'utf8')).trim();
        const pid = Number(raw);
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch {
        return null;
    }
}

async function writePid(pid) {
    try {
        await writeFileAtomic(CORE_PID_FILE, String(pid));
    } catch {
        // A missing PID file only degrades stop() to a no-op; not fatal.
    }
}

async function clearPid() {
    await fsp.unlink(CORE_PID_FILE).catch(() => {});
}

/**
 * Snapshot used by /api/status: HTTP reachability plus process facts.
 * Returns the memory of the PID we started when it is known, otherwise the
 * only running core, otherwise the sum.
 */
async function getStatus() {
    const [running, processes, pid] = await Promise.all([probeCore(), sampleProcesses(), readPid()]);
    let memory = 0;
    if (running && processes.length) {
        const mine = pid ? processes.find((p) => p.pid === pid) : null;
        memory = mine ? mine.memory : processes.reduce((sum, p) => sum + p.memory, 0);
    }
    return { running, memory, pid, processCount: processes.length };
}

/** Spawn the core unless one is already reachable on the controller. */
async function start() {
    if (await probeCore()) {
        return { started: false, alreadyRunning: true };
    }
    if (!fs.existsSync(MIHOMO_RUN)) {
        return { started: false, error: `core binary not found: ${MIHOMO_RUN}` };
    }
    if (!fs.existsSync(CONFIG_PATH)) {
        return { started: false, error: `config not found: ${CONFIG_PATH}` };
    }
    const child = spawn(MIHOMO_RUN, ['-d', DATA_DIR, '-f', CONFIG_PATH], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    child.unref();
    await writePid(child.pid);
    invalidateSample();
    return { started: true, pid: child.pid };
}

/**
 * Stop the core we started. Falls back to the single running core when no PID
 * is recorded, and never touches unrelated processes.
 */
async function stop() {
    const processes = await sampleProcesses(true);
    const pid = await readPid();
    let target = null;
    if (pid && processes.some((p) => p.pid === pid)) {
        target = pid;
    } else if (!pid && processes.length === 1) {
        target = processes[0].pid;
    }
    if (target === null) {
        await clearPid();
        return { stopped: false, reason: pid ? 'recorded-pid-not-running' : 'no-recorded-pid' };
    }
    try {
        process.kill(target, 'SIGKILL');
    } catch (err) {
        return { stopped: false, reason: err.code || 'kill-failed', pid: target };
    }
    await clearPid();
    invalidateSample();
    return { stopped: true, pid: target };
}

/**
 * Stop then start the core, waiting for the controller port to be released.
 * Without the wait, start() would see the dying process still answering and
 * skip the spawn, leaving no core running at all.
 */
async function restart({ waitMs = 6000, intervalMs = 250 } = {}) {
    await stop();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        if (!(await probeCore())) break;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return start();
}

module.exports = { getStatus, start, stop, restart, readPid, sampleProcesses, invalidateSample, PROCESS_NAME };
