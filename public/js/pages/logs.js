// Logs: server-side history plus the live WebSocket stream.
import { api } from '../api.js';
import { state } from '../store.js';
import { esc, delegate } from '../dom.js';
import { onWsMessage } from '../ws.js';

export async function loadLg(){const d=await api('/logs');if(d&&Array.isArray(d)){state.logs=d.slice(-200);if(state.pg==='logs')renderLg();}}

export function renderLg(){document.getElementById('logBox').innerHTML=state.logs.map(l=>{const lv=(l.type||'info').toLowerCase(),cls=lv==='warning'?'lw':lv==='error'?'le':'li';return`<div class="ll"><span class="lt">[${esc(l.time||'')}]</span> <span class="${cls}">[${esc(l.type||'INFO')}]</span> ${esc(l.payload||'')}</div>`;}).join('');document.getElementById('logBox').scrollTop=99999;}

export function clearLogs(){state.logs=[];renderLg();}

export function mount(root) {
    let frame = null;

    /** Coalesce bursts of log lines into one repaint per animation frame. */
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            renderLg();
        });
    };

    const disposers = [
        delegate(root, 'click', '[data-action="clear-logs"]', () => clearLogs()),
        onWsMessage((message) => {
            if (message.type === 'log') schedule();
        })
    ];

    loadLg();

    return () => {
        if (frame) cancelAnimationFrame(frame);
        disposers.forEach((off) => off && off());
    };
}
