// Profiles: subscription cards, add/edit dialogs and the apply/update/delete
// actions.
import { api } from '../api.js';
import { state, onEvent } from '../store.js';
import { T } from '../i18n.js';
import { esc, delegate } from '../dom.js';
import { fmtSz } from '../format.js';
import { toast } from '../components/toast.js';
import { cdropGet, cdropSet } from '../components/cdrop.js';
import { showDlg, closeDlg, closeEditDlg, showEditDlg } from '../components/dialogs.js';
import { refreshStatus } from '../status.js';
import { navigate } from '../router.js';
import { loadPx } from './proxies.js';

export async function loadPf(){
            const r=await api('/profiles');
            const list=document.getElementById('pList');
            const empty=document.getElementById('pEmpty2');
            if(!r||!r.profiles||!r.profiles.length){list.innerHTML='';empty.style.display='block';return;}
            if(r.active!==undefined){state.activePf=r.active||'';localStorage.setItem('activePf',state.activePf);}
            empty.style.display='none';
            list.innerHTML=r.profiles.map(p=>{
                const hasUrl=!!p.url;
                const nodeCount=p.nodeCount||0;
                const safeName=esc(p.name);
                const safeDisplay=esc(p.displayName||p.name.replace(/\.yaml$|\.yml$/,''));
                const safeUrl=esc(p.url||'');
                const urlHtml=hasUrl?`<div class="pf-url" title="${safeUrl}" data-action="copy-url" data-url="${safeUrl}">🔗 ${safeUrl}</div>`:'';
                const interval=p.interval||0;
                const intervalLabel=interval===0?'':interval<60?interval+'min':(interval/60)+'h';
                let subInfoHtml='';
                if(hasUrl&&(p.total>0||p.expire>0)){
                    const used=(p.upload||0)+(p.download||0);
                    const total=p.total||0;
                    const pct=total>0?((used/total)*100).toFixed(1):0;
                    const pctColor=pct>80?'var(--rd)':pct>50?'var(--yl)':'var(--gn)';
                    const expireStr=p.expire>0?new Date(p.expire*1000).toLocaleDateString():T('pf.forever');
                    const updateStr=p.lastUpdate?new Date(p.lastUpdate).toLocaleString():'-';
                    subInfoHtml=`<div class="pf-subinfo"><div class="pf-traffic"><span class="pf-traffic-bar"><span style="width:${Math.min(pct,100)}%;background:${pctColor}"></span></span><span class="pf-traffic-text">${fmtSz(used)} / ${fmtSz(total)} (${pct}%)</span></div><div class="pf-sub-meta"><span>${T('pf.expire')}: ${esc(expireStr)}</span><span>${T('pf.updatedAt')}: ${esc(updateStr)}</span></div></div>`;
                }
                const metaHtml=`<div class="pf-meta"><span>${fmtSz(p.size)}</span><span>${esc(new Date(p.modified).toLocaleDateString())}</span>${nodeCount?`<span>${nodeCount} ${T('pf.nodesLower')}</span>`:''}${intervalLabel?`<span style="color:var(--gn)">⏰ ${esc(intervalLabel)}</span>`:''}</div>`;
                const isActive=p.name===state.activePf;
                return `<div class="pf-card${isActive?' active':''}"><div class="pf-top"><div class="pf-info"><div class="pf-name">${safeDisplay}${isActive?'<span class="tag" style="background:var(--gn)">ACTIVE</span>':p.aggregate?'<span class="tag" style="background:var(--ac)">FREE</span>':hasUrl?'<span class="tag">SUB</span>':''}</div>${urlHtml}${metaHtml}${subInfoHtml}</div></div><div class="pf-btns"><button class="btn bp bs" data-action="apply" data-name="${safeName}"><span class="material-icons-round">play_arrow</span><span>${T('pf.apply')}</span></button><button class="btn bo bs" data-action="update" data-name="${safeName}"><span class="material-icons-round">refresh</span><span>${T('pf.upd')}</span></button><button class="btn bo bs" data-action="edit" data-name="${safeName}"><span class="material-icons-round">edit</span><span>${T('pf.editB')}</span></button><button class="btn bd bs" data-action="delete" data-name="${safeName}"><span class="material-icons-round">delete</span><span>${T('pf.del')}</span></button></div></div>`;
            }).join('');
        }

export async function saveProf(){const n=document.getElementById('pName').value.trim(),u=document.getElementById('pUrl').value.trim(),c=document.getElementById('pYaml').value.trim();if(!n&&!u){toast(T('t.nameReq'));return;}if(!u&&!c){toast(T('t.contentReq'));return;}const r=await api('/profiles',{method:'POST',body:{name:n,content:c,url:u||undefined}});if(!r||!r.success){toast(T('t.addFail')+': '+(r?.error||T('t.noServer')));return;}closeDlg();document.getElementById('pName').value='';document.getElementById('pUrl').value='';document.getElementById('pYaml').value='';loadPf();toast(T('t.saved'));}

export async function refreshFree(){
    // A previous poll left running would keep hitting the API after the user
    // navigates away; clear it before starting a new one.
    if (state.freePollTimer) { clearInterval(state.freePollTimer); state.freePollTimer = null; }
    const r=await api('/free-sources/refresh',{method:'POST'});
    if(!r)return toast(T('t.noServer'));
    if(r.busy)return toast(T('t.freeBusy'));
    if(!r.started)return toast(T('t.freeFail')+': '+(r.error||''));
    toast(T('t.freeRunning'));
    const startedAt=Date.now();
    const iv=setInterval(async()=>{
        const s=await api('/free-sources');
        if(!s)return;
        if(s.running){if(Date.now()-startedAt>180000){clearInterval(iv);state.freePollTimer=null;toast(T('t.freeFail'));}}
        clearInterval(iv);
        state.freePollTimer=null;
        loadPf();
        const lr=s.lastRun;
        if(lr&&lr.ok)toast(`${T('t.freeDone')}: ${lr.alive||0}/${lr.total||0} ${T('pf.nodesLower')}`);
        else toast(T('t.freeFail')+': '+((lr&&lr.error)||''));
    },3000);
    state.freePollTimer=iv;
}

export async function applyPf(n){const r=await api('/profiles/'+encodeURIComponent(n)+'/apply',{method:'POST'});if(!r)return toast(T('t.noServer'));if(!r.success)return toast(T('t.applyFail')+': '+(r.error||T('t.unknown')));state.activePf=n;localStorage.setItem('activePf',n);loadPf();refreshStatus();toast(T('t.updating'));setTimeout(()=>{navigate('/proxies');let t=0;const iv=setInterval(()=>{loadPx();t++;if(t>20||document.querySelector('.nc')){clearInterval(iv);toast(T('t.applied'));}},1000);},1500);}

export async function delPf(n){await api('/profiles/'+encodeURIComponent(n),{method:'DELETE'});loadPf();toast(T('t.deleted'));}

export async function updPf(n){toast(T('t.updating'));const r=await api('/profiles/'+encodeURIComponent(n)+'/update',{method:'POST'});if(r&&r.success){toast(T('t.updated'));loadPf();}else toast('Error: '+(r?.error||''));}

export async function editPf(n){state.editFileName=n;const r=await api('/profiles');const p=r?.profiles?.find(x=>x.name===n);if(!p)return;document.getElementById('editName').value=p.displayName||p.name.replace(/\.yaml$|\.yml$/,'');document.getElementById('editUrl').value=p.url||'';cdropSet('editInterval',p.interval||0);document.getElementById('editDlg').classList.add('show');}

export async function saveEdit(){const displayName=document.getElementById('editName').value.trim();const url=document.getElementById('editUrl').value.trim();const interval=parseInt(cdropGet('editInterval'))||0;const r=await api('/profiles/'+encodeURIComponent(state.editFileName)+'/meta',{method:'PUT',body:{url:url||null,interval,displayName:displayName||null}});if(r&&r.success){closeEditDlg();toast(T('t.saved'));loadPf();}}

export function mount(root) {
    const disposers = [
        // Buttons inside the page container.
        delegate(root, 'click', '[data-action]', (event, el) => {
            const action = el.dataset.action;
            const name = el.dataset.name;
            if (action === 'copy-url') navigator.clipboard.writeText(el.dataset.url || '');
            else if (action === 'apply') applyPf(name);
            else if (action === 'update') updPf(name);
            else if (action === 'edit') editPf(name);
            else if (action === 'delete') delPf(name);
            else if (action === 'add-profile') showDlg();
            else if (action === 'add-free') refreshFree();
            else if (action === 'save-profile') saveProf();
        }),
        // The dialogs live outside the page container, so their buttons are
        // bound at the document level and removed again on unmount.
        delegate(document, 'click', '[data-action]', (event, el) => {
            if (el.closest('#pg-profiles')) return; // handled above
            const action = el.dataset.action;
            if (action === 'close-dialog') closeDlg();
            else if (action === 'close-edit-dialog') closeEditDlg();
            else if (action === 'save-edit') saveEdit();
        }),
        onEvent('refresh', () => loadPf())
    ];

    loadPf();

    return () => {
        // Stop the free-aggregate polling interval so it does not keep
        // hitting the API (and calling loadPf on a detached page) after
        // the user navigates away.
        if (state.freePollTimer) { clearInterval(state.freePollTimer); state.freePollTimer = null; }
        disposers.forEach((off) => off && off());
    };
}
