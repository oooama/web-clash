// Proxies: group tabs, node grid, latency colouring and node selection.
import { api } from '../api.js';
import { state, onEvent } from '../store.js';
import { esc, delegate } from '../dom.js';

export async function loadPx(){const d=await api('/proxies');if(!d||d.error)return;state.allInfo=d;const g={};for(const[k,v]of Object.entries(d)){if(v.all&&v.all.length>0)g[k]=v;}state.pData=g;const tabs=document.getElementById('gTabs'),nodes=document.getElementById('nodes'),empty=document.getElementById('pEmpty');const gn=Object.keys(g);if(!gn.length){tabs.innerHTML='';nodes.innerHTML='';empty.style.display='block';return;}empty.style.display='none';if(!state.curGroup||!g[state.curGroup])state.curGroup=gn[0];tabs.innerHTML=gn.map(n=>`<button class="gt ${n===state.curGroup?'on':''}" data-g="${esc(n)}">${esc(n)}</button>`).join('');renderNd();}

export function selG(n){state.curGroup=n;document.querySelectorAll('.gt').forEach(t=>{t.classList.toggle('on',t.dataset.g===n);});renderNd();}

export function renderNd(){const g=state.pData[state.curGroup];if(!g)return;document.getElementById('nodes').innerHTML=g.all.map(n=>{const on=g.now===n,ni=state.allInfo[n]||{},h=ni.history||[],ld=h.length?h[h.length-1].delay:0,alive=ni.alive||false;let dc='o',dt='--';if(ld>0){dt=ld+'ms';dc=ld<200?'f':ld<500?'m':'s';}return`<div class="nc ${on?'on':''}" data-g="${esc(state.curGroup)}" data-n="${esc(n)}"><div class="ns ${alive?'a':'d'}"></div><span class="nn">${esc(n)}</span><span class="nd ${dc}">${dt}</span></div>`;}).join('');}

export async function selPx(g,n){await api('/proxies/'+encodeURIComponent(g),{method:'PUT',body:{name:n}});loadPx();}

export function mount(root) {
    const disposers = [
        delegate(root, 'click', '.gt', (event, el) => {
            if (el.dataset.g !== undefined) selG(el.dataset.g);
        }),
        delegate(root, 'click', '.nc', (event, el) => {
            if (el.dataset.n !== undefined) selPx(el.dataset.g, el.dataset.n);
        }),
        onEvent('refresh', () => loadPx())
    ];

    loadPx();

    return () => disposers.forEach((off) => off && off());
}
