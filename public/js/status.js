// Core status: the single owner of /api/status polling and the core toggle.
//
// The old checkSt() ran every 5s from anywhere and also shelled out to read the
// Windows proxy state on each tick. The proxy state is now read on demand
// (settings page) and after a toggle; the status poll only reads /api/status.
import { api } from './api.js';
import { state, emit } from './store.js';
import { T } from './i18n.js';
import { toast } from './components/toast.js';

const POLL_MS = 5000;
let timer = null;

/** Read /api/status once and broadcast the result. */
export async function refreshStatus() {
    const result = await api('/status');
    if (!result) return null;
    state.status = result;
    state.coreOn = !!result.running;
    emit('status', result);
    return result;
}

export function startStatusPolling() {
    if (timer) return;
    refreshStatus();
    timer = setInterval(refreshStatus, POLL_MS);
}

export function stopStatusPolling() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

/** Read the Windows proxy state and broadcast it. */
export async function refreshSystemProxy() {
    const result = await api('/system-proxy');
    state.systemProxy = result ? !!result.enabled : null;
    emit('system-proxy', state.systemProxy);
    return state.systemProxy;
}

/**
 * Turn the core and the Windows system proxy on or off together.
 * Optimistically updates the UI, then reconciles from the server.
 */
export async function toggleCore() {
    const turningOn = !state.coreOn;
    state.coreOn = turningOn;
    emit('status', state.status);

    if (turningOn) {
        toast(T('t.coreOn'));
        await api('/start', { method: 'POST' });
        await api('/system-proxy', { method: 'POST', body: { enable: true } });
    } else {
        toast(T('t.coreOff'));
        await api('/stop', { method: 'POST' });
        await api('/system-proxy', { method: 'POST', body: { enable: false } });
    }
    state.systemProxy = turningOn;
    emit('system-proxy', turningOn);
    setTimeout(refreshStatus, 3000);
}
