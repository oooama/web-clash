// Shared mutable state and a minimal event bus.
//
// The old page kept every piece of state in module-level globals that all
// functions reached into. Modules now share this single object, and react to
// changes through events instead of polling each other.
export const state = {
    pg: 'dashboard',
    coreOn: false,
    curGroup: '',
    pData: {},
    allInfo: {},
    logs: [],
    rules: [],
    ruleQuery: '',
    activePf: localStorage.getItem('activePf') || '',
    editFileName: '',
    lastCnHtml: null,
    wsRetry: 1000,
    wsTimer: null,
    status: null,
    systemProxy: null
};

const listeners = new Map();

/** Subscribe to an event; returns an unsubscribe function. */
export function onEvent(name, handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
    return () => {
        const set = listeners.get(name);
        if (set) set.delete(handler);
    };
}

export function emit(name, detail) {
    const set = listeners.get(name);
    if (!set) return;
    for (const handler of [...set]) {
        try {
            handler(detail);
        } catch (err) {
            console.error('[event] ' + name + ' handler failed:', err);
        }
    }
}

export const LOG_LIMIT = 500;
export const CONNECTION_PREVIEW_LIMIT = 100;
