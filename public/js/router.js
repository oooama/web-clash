// History-API router.
//
// Routes are loaded on demand: the first visit to a page fetches only that
// page's module, and the shell never ships every page up front. Each page may
// return a cleanup function from mount(), which runs before the next page
// mounts, so timers and subscriptions cannot leak across navigations.
import { pageMap, T } from './i18n.js';
import { state, emit } from './store.js';
import { setActiveSignal } from './api.js';
import { setActiveNav } from './components/chrome.js';

const ROUTES = {
    dashboard: () => import('./pages/dashboard.js'),
    proxies: () => import('./pages/proxies.js'),
    profiles: () => import('./pages/profiles.js'),
    rules: () => import('./pages/rules.js'),
    connections: () => import('./pages/connections.js'),
    logs: () => import('./pages/logs.js'),
    settings: () => import('./pages/settings.js')
};

const DEFAULT_ROUTE = 'dashboard';
const ROUTE_NAMES = Object.keys(ROUTES);
const modules = new Map();

let active = null;
let generation = 0;
let currentController = null;

/** '/profiles/anything' -> 'profiles'; unknown names -> null. */
function normalize(path) {
    const name = String(path || '')
        .replace(/^\/+/, '')
        .split('?')[0]
        .split('/')[0];
    if (!name) return DEFAULT_ROUTE;
    return ROUTE_NAMES.includes(name) ? name : null;
}
/** Abort in-flight reads and release the outgoing page. */
function disposeActive() {
    if (currentController) {
        currentController.abort();
        currentController = null;
    }
    if (!active) return;
    if (active.cleanup) {
        try {
            active.cleanup();
        } catch (err) {
            console.error('[router] cleanup failed for ' + active.name + ':', err);
        }
    }
    active = null;
}
function loadPage(name) {
    if (!modules.has(name)) modules.set(name, ROUTES[name]());
    return modules.get(name);
}

/**
 * Show a route.
 * historyMode: 'push' | 'replace' | 'none' (none = the URL already changed,
 * e.g. a popstate event).
 */
export async function navigate(path, { historyMode = 'push', force = false } = {}) {
    const name = normalize(path);
    if (!name) {
        return navigate('/' + DEFAULT_ROUTE, { historyMode: 'replace', force: true });
    }
    if (!force && active && active.name === name) return;

    const gen = (generation += 1);

    if (historyMode === 'push') history.pushState({ route: name }, '', '/' + name);
    else if (historyMode === 'replace') history.replaceState({ route: name }, '', '/' + name);

    document.querySelectorAll('.page').forEach((el) => el.classList.remove('on'));
    const pageEl = document.getElementById('pg-' + name);
    if (pageEl) pageEl.classList.add('on');

    state.pg = name;
    setActiveNav(name);
    const title = document.getElementById('pageTitle');
    if (title) title.textContent = T(pageMap[name]);

    disposeActive();

    // Reads issued by the outgoing page are aborted; reads issued by the page
    // about to mount use this controller. Mutations are never aborted.
    const controller = new AbortController();
    setActiveSignal(controller.signal);
    currentController = controller;

    const mod = await loadPage(name);
    if (gen !== generation) return; // a newer navigation superseded this one

    let cleanup = null;
    try {
        cleanup = mod.mount ? mod.mount(pageEl, { signal: controller.signal }) : null;
    } catch (err) {
        console.error('[router] mount failed for ' + name + ':', err);
    }
    active = { name, cleanup: typeof cleanup === 'function' ? cleanup : null };
    emit('route', name);
}

/** Re-mount the current route in place (used after a language switch). */
export function reload() {
    return navigate('/' + state.pg, { historyMode: 'none', force: true });
}

/** Intercept in-app links and handle back/forward, then show the first route. */
export function start() {
    document.addEventListener('click', (event) => {
        const link = event.target.closest('a[data-route]');
        if (!link) return;
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(link.dataset.route);
    });

    window.addEventListener('popstate', () => {
        navigate(location.pathname, { historyMode: 'none' });
    });

    navigate(location.pathname, { historyMode: 'replace', force: true });
}
