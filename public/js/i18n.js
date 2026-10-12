// Translations and the route -> label mapping.
//
// `lang` is module state; changing it emits 'langchange' so the router can
// re-mount the active page instead of this module knowing about every page.
import { emit } from './store.js';

export const L = {en:{'nav.d':'Dashboard','nav.p':'Proxies','nav.pf':'Profiles','nav.r':'Rules','nav.c':'Connections','nav.l':'Logs','nav.s':'Settings','s.on':'Connected','s.off':'Disconnected','d.spd':'Network Speed','d.up':'Upload','d.dn':'Download','d.mode':'Outbound Mode','d.info':'Connection Info','d.extIP':'External IP','d.proxyPort':'Proxy Port','d.apiPort':'API Port','d.conn':'Active Connections','d.sys':'System Info','d.mem':'Memory','d.uptime':'Uptime','m.rule':'Rule','m.global':'Global','m.direct':'Direct','px.empty':'No Proxies','px.emptyD':'Import a profile first','pf.add':'Add Profile','pf.empty':'No Profiles','pf.emptyD':'Add subscription or paste config','pf.addT':'Add Profile','pf.edit':'Edit Profile','pf.name':'Name','pf.url':'Subscription URL','pf.yaml':'Or paste YAML','pf.apply':'Apply','pf.del':'Delete','pf.upd':'Update','pf.editB':'Edit','pf.nodes':'Nodes','pf.interval':'Auto Update','pf.off':'Off','r.save':'Save Rules','r.empty':'No Rules','r.emptyD':'Add custom rules to control traffic','cn.close':'Close All','cn.empty':'No Connections','cn.emptyD':'Active connections appear here','lg.clear':'Clear','st.proxy':'Proxy Settings','st.mixed':'Mixed Port','st.lan':'Allow LAN','st.lanD':'Allow LAN devices','st.ipv6D':'Enable IPv6','st.sysP':'System Proxy','st.setP':'System Proxy Status','st.setPD':'Click FAB to toggle','st.core':'Core Service','st.coreS':'Core Status','st.about':'About','b.cancel':'Cancel','b.save':'Save','t.coreOn':'Core + Proxy ON','t.coreOff':'Core + Proxy OFF','t.mode':'Mode','t.refreshed':'Refreshed','t.saved':'Saved','t.deleted':'Deleted','t.applied':'Applied','t.updating':'Updating...','t.updated':'Updated','t.rulesSaved':'Rules saved','t.nameReq':'Enter name or URL','t.contentReq':'Enter URL or paste config','pf.forever':'Forever','pf.expire':'Expires','pf.updatedAt':'Updated','pf.nodesLower':'nodes','t.modeFail':'Mode switch failed','t.noServer':'Cannot connect to server','t.addFail':'Add failed','t.applyFail':'Apply failed','t.unknown':'Unknown error','t.saveFail':'Save failed','st.checking':'Checking...'},zh:{'nav.d':'仪表盘','nav.p':'代理','nav.pf':'配置','nav.r':'规则','nav.c':'连接','nav.l':'日志','nav.s':'设置','s.on':'已连接','s.off':'未连接','d.spd':'网速','d.up':'上行','d.dn':'下行','d.mode':'出站模式','d.info':'连接信息','d.extIP':'外部 IP','d.proxyPort':'代理端口','d.apiPort':'API 端口','d.conn':'活跃连接','d.sys':'系统信息','d.mem':'内存','d.uptime':'运行时间','m.rule':'规则','m.global':'全局','m.direct':'直连','px.empty':'暂无代理','px.emptyD':'请先导入配置','pf.add':'添加配置','pf.empty':'暂无配置','pf.emptyD':'添加订阅链接或粘贴配置内容','pf.addT':'添加配置','pf.edit':'编辑配置','pf.name':'配置名称','pf.url':'订阅链接','pf.yaml':'或粘贴 YAML','pf.apply':'应用','pf.del':'删除','pf.upd':'更新','pf.editB':'编辑','pf.nodes':'节点','pf.interval':'自动更新间隔','pf.off':'关闭','r.save':'保存规则','r.empty':'暂无规则','r.emptyD':'添加自定义规则以控制流量走向','cn.close':'关闭全部','cn.empty':'暂无连接','cn.emptyD':'活跃连接将显示在此','lg.clear':'清空','st.proxy':'代理设置','st.mixed':'混合端口','st.lan':'允许局域网','st.lanD':'允许局域网设备连接','st.ipv6D':'启用 IPv6 支持','st.sysP':'系统代理','st.setP':'系统代理状态','st.setPD':'点击右下角按钮一键开启/关闭','st.core':'核心服务','st.coreS':'核心状态','st.about':'关于','b.cancel':'取消','b.save':'保存','t.coreOn':'核心 + 代理 已开启','t.coreOff':'核心 + 代理 已关闭','t.mode':'模式','t.refreshed':'已刷新','t.saved':'已保存','t.deleted':'已删除','t.applied':'已应用','t.updating':'更新中...','t.updated':'已更新','t.rulesSaved':'规则已保存','t.nameReq':'请输入名称或URL','t.contentReq':'请输入URL或粘贴配置内容','pf.forever':'永久','pf.expire':'到期','pf.updatedAt':'更新','pf.nodesLower':'节点','t.modeFail':'模式切换失败','t.noServer':'无法连接服务器','t.addFail':'添加失败','t.applyFail':'应用失败','t.unknown':'未知错误','t.saveFail':'保存失败','st.checking':'检查中...'}};

export const pageMap = {dashboard:'nav.d',proxies:'nav.p',profiles:'nav.pf',rules:'nav.r',connections:'nav.c',logs:'nav.l',settings:'nav.s'};

let lang = localStorage.getItem('lang') || 'zh';

export function getLang() {
    return lang;
}

export function T(k){return(L[lang]&&L[lang][k])||L.en[k]||k;}

export function applyI18n(){document.querySelectorAll('[data-i18n]').forEach(e=>{e.textContent=T(e.dataset.i18n);});document.getElementById('langBtn').textContent=lang==='zh'?'EN':'中文';}

/** Switch language, persist it, re-apply the static labels and notify pages. */
export function toggleLang() {
    lang = lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('lang', lang);
    applyI18n();
    emit('langchange', lang);
}
