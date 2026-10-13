'use strict';
// Subscription fetching. The core-YAML branch below parses the response, so it
// needs the YAML module (the original single-file server had it at file scope).
const YAML = require('yaml');
const { convertSubscription, wrapProxies } = require('./subscription-convert');
const { parseSubscriptionInfo } = require('./subscription-info');

async function fetchAndConvertSub(url) {
    const resp = await fetch(url, {
        headers: { 'User-Agent': 'clash.meta', 'Accept': '*/*' },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow'
    });
    if (!resp.ok) {
        return { error: `订阅请求失败 (HTTP ${resp.status})，请检查链接是否正确或稍后重试` };
    }
    const subInfo = parseSubscriptionInfo(resp.headers);
    const text = await resp.text();
    if (/<html|<!DOCTYPE/i.test(text)) {
        return { error: '订阅链接被Cloudflare防护拦截，请更换链接或手动粘贴配置内容' };
    }
    const converted = convertSubscription(text);
    let yamlContent;
    if (converted.alreadyYaml) {
        try {
            const parsed = YAML.parse(text);
            if (!parsed || typeof parsed !== 'object' || (!parsed.proxies && !parsed['proxy-groups'])) {
                return { error: '订阅内容不是有效的代理配置，请尝试手动粘贴' };
            }
            yamlContent = text;
        } catch (e) {
            return { error: '订阅YAML解析失败: ' + e.message };
        }
    } else if (converted.proxies.length > 0) {
        yamlContent = wrapProxies(converted.proxies);
    } else {
        return { error: '订阅内容无法解析（未找到任何节点），请尝试手动粘贴配置' };
    }
    return { yamlContent, subInfo };
}

module.exports = { fetchAndConvertSub };
