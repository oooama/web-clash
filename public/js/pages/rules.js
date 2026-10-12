// Rules: add, delete and persist custom routing rules.
//
// Every value rendered here is escaped. The previous implementation
// interpolated the rule type, match and target straight into innerHTML, so a
// rule arriving from a subscription could execute script in the console.
import { api } from '../api.js';
import { state, onEvent } from '../store.js';
import { T } from '../i18n.js';
import { esc, delegate } from '../dom.js';
import { cdropGet } from '../components/cdrop.js';
import { toast } from '../components/toast.js';

export async function loadRules(){const r=await api('/rules');state.rules=r?.rules||[];renderRules();}

export function renderRules(){const list=document.getElementById('ruleList'),empty=document.getElementById('rEmpty');if(!state.rules.length){list.innerHTML='';empty.style.display='block';return;}empty.style.display='none';list.innerHTML=state.rules.map((r,i)=>{const parts=r.split(',');const type=parts[0]||'';const match=parts[1]||'';const target=parts[2]||'';return`<div class="rule-item"><span class="ri-type">${esc(type)}</span><span class="ri-match">${esc(match)}</span><span class="ri-target">${esc(target)}</span><button class="ri-del" data-index="${i}"><span class="material-icons-round">close</span></button></div>`;}).join('');}

export function addRule(){const type=cdropGet('ruleType');const match=document.getElementById('ruleMatch').value.trim();const target=cdropGet('ruleTarget');if(!match){return;}state.rules.push(type+','+match+','+target);document.getElementById('ruleMatch').value='';renderRules();}

export function delRule(i){state.rules.splice(i,1);renderRules();}

export async function saveRules(){await api('/rules',{method:'PUT',body:{rules: state.rules}});toast(T('t.rulesSaved'));}

export function mount(root) {
    const disposers = [
        delegate(root, 'click', '[data-action="add-rule"]', () => addRule()),
        delegate(root, 'click', '[data-action="save-rules"]', () => saveRules()),
        delegate(root, 'click', '[data-action="reload-rules"]', () => loadRules()),
        delegate(root, 'click', '.ri-del', (event, el) => delRule(Number(el.dataset.index))),
        onEvent('refresh', () => loadRules())
    ];

    loadRules();

    return () => disposers.forEach((off) => off && off());
}
