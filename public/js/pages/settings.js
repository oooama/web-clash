// Settings: mixed port, LAN, IPv6 and the core / system-proxy read-outs.
import { api } from '../api.js';
import { state, onEvent } from '../store.js';
import { T, getLang } from '../i18n.js';
import { delegate } from '../dom.js';
import { CONSOLE_HEADER } from '../api.js';
import { toast } from '../components/toast.js';
import { refreshSystemProxy } from '../status.js';

export async function loadSt(){const r=await api('/config');const c=(r&&r.config)||{};document.getElementById('sPort').value=c['mixed-port']||7890;document.getElementById('sLan').classList.toggle('on',!!c['allow-lan']);document.getElementById('sIpv6').classList.toggle('on',!!c['ipv6']);document.getElementById('coreD').textContent=state.coreOn?(getLang()==='zh'?'运行中':'Running'):(getLang()==='zh'?'已停止':'Stopped');}

export function tglSw(e){e.classList.toggle('on');}

export async function saveSt(){const r=await api('/config');if(!r||!r.success)return;const cfg=r.config||{};cfg['mixed-port']=parseInt(document.getElementById('sPort').value)||7890;cfg['allow-lan']=document.getElementById('sLan').classList.contains('on');cfg['ipv6']=document.getElementById('sIpv6').classList.contains('on');const w=await api('/config',{method:'POST',body:cfg});if(!w||!w.success){toast(T('t.saveFail'));return;}if(state.coreOn){try{await fetch('/api/configs?force=true',{method:'PUT',headers:CONSOLE_HEADER,body:JSON.stringify(cfg)});}catch{}}toast(T('t.saved'));}

export function mount(root) {
    const disposers = [
        delegate(root, 'change', '#sPort', () => saveSt()),
        delegate(root, 'click', '.sw', (event, el) => {
            tglSw(el);
            saveSt();
        }),
        onEvent('refresh', () => {
            loadSt();
            refreshSystemProxy();
        })
    ];

    loadSt();
    refreshSystemProxy();

    return () => disposers.forEach((off) => off && off());
}
