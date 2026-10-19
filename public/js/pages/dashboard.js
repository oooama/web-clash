// Dashboard: outbound mode, live throughput and the external IP.
import { api } from '../api.js';
import { onEvent } from '../store.js';
import { T } from '../i18n.js';
import { fmtB } from '../format.js';
import { qs, delegate } from '../dom.js';
import { toast } from '../components/toast.js';
import { refreshStatus } from '../status.js';

const TRAFFIC_MS = 2000;
const EXT_IP_MS = 5 * 60 * 1000;

/**
 * Highlight the chip matching the mode the core is actually running.
 *
 * The markup ships with 规则 pre-selected, so without this the UI keeps claiming
 * "rule" while the core runs something else (and a global core with GLOBAL=DIRECT
 * silently sends everything direct). The file is only the fallback, for when the
 * core is down and there is no live mode to read.
 */
export async function syncMode(){
    let mode='';
    const live=await api('/configs');
    if(live&&live.mode)mode=live.mode;
    if(!mode){const local=await api('/config');mode=(local&&local.config&&local.config.mode)||'';}
    if(!mode)return;
    document.querySelectorAll('.mchip').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode));
}

/**
 * Switch the outbound mode. POST /mode persists it to config.yaml and applies it
 * to the core, so the choice survives a restart; PATCH /configs would not.
 */
export async function setMode(m){
    document.querySelectorAll('.mchip').forEach(b=>{b.classList.toggle('on',b.dataset.mode===m);});
    const r=await api('/mode',{method:'POST',body:{mode:m}});
    if(!r||!r.success){await syncMode();toast(T('t.modeFail'));return;}
    await syncMode();
    toast(T('t.mode')+': '+m);
}

export async function updSpd(){const d=await api('/traffic');if(!d||!Array.isArray(d)||!d.length)return;const last=d[d.length-1];document.getElementById('upSpd').textContent=fmtB(last.up||0)+'/s';document.getElementById('dnSpd').textContent=fmtB(last.down||0)+'/s';}

/** Ask the proxy for the current exit IP (cached server-side for 5 minutes). */
async function loadExternalIp() {
    const result = await api('/ext-ip');
    if (!result) return;
    qs('extIP').textContent = result.ip || '--';
}

export function mount(root) {
    const disposers = [
        delegate(root, 'click', '.mchip', (event, el) => setMode(el.dataset.mode)),
        onEvent('refresh', () => {
            refreshStatus();
            updSpd();
            loadExternalIp();
            toast(T('t.refreshed'));
        })
    ];

    const trafficTimer = setInterval(updSpd, TRAFFIC_MS);
    const extIpTimer = setInterval(loadExternalIp, EXT_IP_MS);
    updSpd();
    loadExternalIp();
    syncMode();

    return () => {
        clearInterval(trafficTimer);
        clearInterval(extIpTimer);
        disposers.forEach((off) => off && off());
    };
}
