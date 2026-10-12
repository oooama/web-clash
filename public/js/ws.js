// WebSocket client for the live log stream.
//
// Reconnects with exponential backoff and keeps the shared log buffer fed even
// when the logs page is not mounted, matching the previous behaviour.
import { state, emit, LOG_LIMIT } from './store.js';

const handlers = new Set();

/** Register a raw-message handler; returns an unsubscribe function. */
export function onWsMessage(handler) {
    handlers.add(handler);
    return () => handlers.delete(handler);
}

export function connectWs() {
    try {
        if (state.wsTimer) {
            clearTimeout(state.wsTimer);
            state.wsTimer = null;
        }
        const socket = new WebSocket(`ws://${location.host}`);
        socket.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (message.type === 'log') {
                state.logs.push(message);
                if (state.logs.length > LOG_LIMIT) state.logs.shift();
            }
            for (const handler of [...handlers]) {
                try {
                    handler(message);
                } catch (err) {
                    console.error('[ws] handler failed:', err);
                }
            }
            emit('ws', message);
        };
        socket.onopen = () => {
            state.wsRetry = 1000;
        };
        socket.onclose = () => {
            state.wsTimer = setTimeout(connectWs, state.wsRetry);
            state.wsRetry = Math.min(state.wsRetry * 2, 30000);
        };
        socket.onerror = () => {
            try {
                socket.close();
            } catch {
                /* already closing */
            }
        };
    } catch {
        state.wsTimer = setTimeout(connectWs, state.wsRetry);
        state.wsRetry = Math.min(state.wsRetry * 2, 30000);
    }
}
