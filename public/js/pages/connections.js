// Connections: active connection list with a close-all action.
import { api } from '../api.js';
import { state, onEvent, CONNECTION_PREVIEW_LIMIT } from '../store.js';
import { esc, delegate } from '../dom.js';
import { fmtB } from '../format.js';

const POLL_MS = 3000;

export async function loadCn(){const d=await api('/connections'),list=document.getElementById('cList'),empty=document.getElementById('cEmpty');const conns=(d&&d.connections)||[];document.getElementById('connCnt').textContent=conns.length;if(!conns.length){if(state.lastCnHtml!==''){state.lastCnHtml='';list.innerHTML='';}empty.style.display='block';return;}empty.style.display='none';const html=conns.slice(0,CONNECTION_PREVIEW_LIMIT).map(c=>{const u=fmtB(c.upload||0),dn=fmtB(c.download||0);return`<div class="cr"><span class="crh">${esc(c.metadata?.host||c.host||'--')}</span><span class="crc">${esc((c.chains||[]).join(' → ')||'--')}</span><span class="crb">↑${u} ↓${dn}</span></div>`;}).join('');if(html===state.lastCnHtml)return;state.lastCnHtml=html;list.innerHTML=html;}

export async function closeConns(){await api('/connections',{method:'DELETE'});loadCn();}

export function mount(root) {
    const disposers = [
        delegate(root, 'click', '[data-action="close-connections"]', () => closeConns()),
        onEvent('refresh', () => loadCn())
    ];

    // Polling only runs while this page is on screen.
    const timer = setInterval(loadCn, POLL_MS);
    loadCn();

    return () => {
        clearInterval(timer);
        disposers.forEach((off) => off && off());
    };
}
