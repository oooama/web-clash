// Entry point: apply the static chrome, start the router and the streams.
import { applyI18n } from './i18n.js';
import { initCdrops } from './components/cdrop.js';
import { initChrome } from './components/chrome.js';
import { start, reload } from './router.js';
import { connectWs } from './ws.js';
import { startStatusPolling, stopStatusPolling, refreshSystemProxy, refreshStatus } from './status.js';
import { onEvent } from './store.js';
import { toast } from './components/toast.js';
import { T } from './i18n.js';

applyI18n();
initCdrops();
initChrome();
startStatusPolling();
connectWs();
refreshSystemProxy();
start();

// A language switch re-renders static labels and re-mounts the active page so
// its dynamic text follows.
onEvent('langchange', () => reload());

// Surface transport failures once, instead of silently showing empty tables.
let lastApiErrorAt = 0;
onEvent('apifail', () => {
    const now = Date.now();
    if (now - lastApiErrorAt < 5000) return;
    lastApiErrorAt = now;
    toast(T('t.noServer'));
});

// Stop polling while the tab is in the background and catch up on return, so a
// console left open in a background tab is not a permanent request source.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopStatusPolling();
    else {
        startStatusPolling();
        refreshStatus();
    }
});
