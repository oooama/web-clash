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

export async function setMode(m){document.querySelectorAll('.mchip').forEach(b=>{b.classList.toggle('on',b.dataset.mode===m);});await api('/configs',{method:'PATCH',body:{mode:m}});const r=await api('/configs');const actual=r&&r.mode;if(actual&&actual!==m){document.querySelectorAll('.mchip').forEach(b=>{b.classList.toggle('on',b.dataset.mode===actual);});toast(T('t.modeFail'));return;}toast(T('t.mode')+': '+m);}

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

    return () => {
        clearInterval(trafficTimer);
        clearInterval(extIpTimer);
        disposers.forEach((off) => off && off());
    };
}
