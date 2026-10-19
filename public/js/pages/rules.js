// Rules: search, add, delete and persist custom routing rules.
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

/** Case-insensitive substring match over the whole rule line. */
function matches(rule,q){return !q||String(rule).toLowerCase().includes(q);}

/** Clear the active search so a freshly added rule is always visible. */
function clearSearch(){
    state.ruleQuery='';
    const input=document.getElementById('ruleSearch');
    if(input)input.value='';
}

export function renderRules(){
    const list=document.getElementById('ruleList');
    const empty=document.getElementById('rEmpty');
    const emptyT=document.getElementById('rEmptyT');
    const emptyD=document.getElementById('rEmptyD');
    const count=document.getElementById('ruleCount');
    const q=String(state.ruleQuery||'').trim().toLowerCase();
    const rows=[];
    state.rules.forEach((rule,i)=>{if(matches(rule,q))rows.push({rule,i});});
    if(count)count.textContent=q?`${rows.length} / ${state.rules.length}`:String(state.rules.length);
    if(!rows.length){
        list.innerHTML='';
        if(emptyT)emptyT.textContent=q?T('r.noMatch'):T('r.empty');
        if(emptyD)emptyD.textContent=q?T('r.noMatchD'):T('r.emptyD');
        empty.style.display='block';
        return;
    }
    empty.style.display='none';
    // data-index keeps the position in state.rules, not in the filtered view,
    // so deleting a row while a search is active removes the right rule.
    list.innerHTML=rows.map(({rule,i})=>{const parts=rule.split(',');const type=parts[0]||'';const match=parts[1]||'';const target=parts[2]||'';return`<div class="rule-item"><span class="ri-type">${esc(type)}</span><span class="ri-match">${esc(match)}</span><span class="ri-target">${esc(target)}</span><button class="ri-del" data-index="${i}"><span class="material-icons-round">close</span></button></div>`;}).join('');
}

export function addRule(){const type=cdropGet('ruleType');const match=document.getElementById('ruleMatch').value.trim();const target=cdropGet('ruleTarget');if(!match){return;}state.rules.push(type+','+match+','+target);document.getElementById('ruleMatch').value='';clearSearch();renderRules();}

export function delRule(i){state.rules.splice(i,1);renderRules();}

export async function saveRules(){await api('/rules',{method:'PUT',body:{rules: state.rules}});toast(T('t.rulesSaved'));}

export function mount(root) {
    const input=document.getElementById('ruleSearch');
    if(input){
        input.placeholder=T('r.search');
        input.value=state.ruleQuery||'';
    }
    const clear=root.querySelector('[data-action="clear-rule-search"]');
    if(clear)clear.title=T('r.clear');

    const disposers = [
        delegate(root, 'input', '#ruleSearch', (event, el) => {
            state.ruleQuery=el.value;
            renderRules();
        }),
        delegate(root, 'click', '[data-action="clear-rule-search"]', () => {
            clearSearch();
            renderRules();
            if(input)input.focus();
        }),
        delegate(root, 'click', '[data-action="add-rule"]', () => addRule()),
        delegate(root, 'click', '[data-action="save-rules"]', () => saveRules()),
        delegate(root, 'click', '[data-action="reload-rules"]', () => loadRules()),
        delegate(root, 'click', '.ri-del', (event, el) => delRule(Number(el.dataset.index))),
        onEvent('refresh', () => loadRules())
    ];

    loadRules();

    return () => disposers.forEach((off) => off && off());
}
