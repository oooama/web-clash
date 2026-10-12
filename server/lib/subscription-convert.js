'use strict';
// Subscription converter (from web-clash) - verbatim move.
const YAML = require('yaml');

// ===== Subscription converter (from web-clash) =====
function b64decode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/').trim();
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const pair of qs.split('&')) {
    const idx = pair.indexOf('=');
    if (idx < 0) { out[pair] = ''; continue; }
    out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
  }
  return out;
}

function nameFromFragment(frag) {
  // URL.hash keeps the leading '#', so `vless://...#Node` used to produce a
  // node literally named "#Node" while ss/ssr/vmess produced clean names.
  return frag ? decodeURIComponent(frag).replace(/^#/, '') : '';
}

function parseVmess(uri) {
  try {
    const json = JSON.parse(b64decode(uri.slice('vmess://'.length)));
    const p = {
      name: json.ps || json.remarks || json.add || 'vmess',
      type: 'vmess',
      server: json.add,
      port: Number(json.port),
      uuid: json.id,
      alterId: Number(json.aid || 0),
      cipher: json.scy || json.cipher || 'auto',
      udp: true,
    };
    if (json.tls === 'tls' || json.tls === true) p.tls = true;
    if (json.sni) p.servername = json.sni;
    if (json.net && json.net !== 'tcp') p.network = json.net;
    if (json.net === 'ws') {
      p['ws-opts'] = { path: json.path || '/' };
      if (json.host) p['ws-opts'].headers = { Host: json.host };
    }
    if (json.net === 'grpc') p['grpc-opts'] = { 'grpc-service-name': json.path || '' };
    return p;
  } catch { return null; }
}

function parseVless(uri) {
  try {
    const u = new URL(uri);
    const q = parseQuery(u.search.slice(1));
    const p = {
      name: nameFromFragment(u.hash) || 'vless',
      type: 'vless',
      server: u.hostname,
      port: Number(u.port),
      uuid: u.username,
      udp: true,
    };
    if (q.flow) p.flow = q.flow;
    if (q.type && q.type !== 'tcp') p.network = q.type;
    if (q.security === 'tls' || q.security === 'reality') {
      p.tls = true;
      if (q.pbk) p['reality-opts'] = { 'public-key': q.pbk, 'short-id': q.sid || '' };
      if (q.sni) p.servername = q.sni;
    }
    if (q.type === 'ws') {
      p['ws-opts'] = { path: q.path || '/' };
      if (q.host) p['ws-opts'].headers = { Host: q.host };
    }
    if (q.type === 'grpc') p['grpc-opts'] = { 'grpc-service-name': q.serviceName || '' };
    return p;
  } catch { return null; }
}

function parseTrojan(uri) {
  try {
    const u = new URL(uri);
    const q = parseQuery(u.search.slice(1));
    const p = {
      name: nameFromFragment(u.hash) || 'trojan',
      type: 'trojan',
      server: u.hostname,
      port: Number(u.port),
      password: decodeURIComponent(u.username),
      udp: true,
    };
    if (q.sni) p.sni = q.sni;
    if (q.allowInsecure === '1') p['skip-cert-verify'] = true;
    if (q.type && q.type !== 'tcp') p.network = q.type;
    if (q.type === 'ws') {
      p['ws-opts'] = { path: q.path || '/' };
      if (q.host) p['ws-opts'].headers = { Host: q.host };
    }
    return p;
  } catch { return null; }
}

function parseSS(uri) {
  try {
    let rest = uri.slice('ss://'.length);
    const hashIdx = rest.indexOf('#');
    const name = hashIdx >= 0 ? decodeURIComponent(rest.slice(hashIdx + 1)) : '';
    if (hashIdx >= 0) rest = rest.slice(0, hashIdx);
    let main = rest;
    let query = {};
    const qIdx = rest.indexOf('?');
    if (qIdx >= 0) { query = parseQuery(rest.slice(qIdx + 1)); main = rest.slice(0, qIdx); }
    let method, password, server, port;
    if (main.includes('@')) {
      const [userinfo, hostport] = main.split('@');
      const dec = /^[A-Za-z0-9+/=_-]+$/.test(userinfo) && userinfo.length > 12 ? b64decode(userinfo) : userinfo;
      const ci = dec.indexOf(':');
      method = dec.slice(0, ci); password = dec.slice(ci + 1);
      const hi = hostport.lastIndexOf(':');
      server = hostport.slice(0, hi); port = Number(hostport.slice(hi + 1));
    } else {
      const dec = b64decode(main);
      const at = dec.lastIndexOf('@');
      const ci = dec.slice(0, at).indexOf(':');
      method = dec.slice(0, ci); password = dec.slice(ci + 1, at);
      const hostport = dec.slice(at + 1);
      const hi = hostport.lastIndexOf(':');
      server = hostport.slice(0, hi); port = Number(hostport.slice(hi + 1));
    }
    const p = { name: name || `${server}:${port}`, type: 'ss', server, port, cipher: method, password, udp: true };
    if (query.plugin) p.plugin = query.plugin;
    return p;
  } catch { return null; }
}

function parseSSR(uri) {
  try {
    const dec = b64decode(uri.slice('ssr://'.length));
    const [main, params] = dec.split('/?');
    const parts = main.split(':');
    if (parts.length < 6) return null;
    const [host, port, protocol, method, obfs, passB64] = parts;
    const q = parseQuery(params);
    return {
      name: q.remarks ? b64decode(q.remarks) : `${host}:${port}`,
      type: 'ssr',
      server: host,
      port: Number(port),
      cipher: method,
      password: b64decode(passB64),
      obfs,
      protocol,
      'obfs-param': q['obfs_param'] || '',
      'protocol-param': q['protoparam'] || '',
      udp: true,
    };
  } catch { return null; }
}

function convertSubscription(rawBody) {
  const proxies = [];
  let errors = 0;
  const trimmed = rawBody.trim();
  if (/^proxies:\s*$/m.test(trimmed) || trimmed.startsWith('proxies:')) {
    return { proxies: [], errors: 0, alreadyYaml: true };
  }
  let text = rawBody;
  if (/^[A-Za-z0-9+/=\s_-]+$/.test(text.replace(/\s/g, '')) && text.length > 32) {
    try { text = b64decode(text.replace(/\s/g, '')); } catch {}
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let p = null;
    if (line.startsWith('vmess://')) p = parseVmess(line);
    else if (line.startsWith('vless://')) p = parseVless(line);
    else if (line.startsWith('trojan://')) p = parseTrojan(line);
    else if (line.startsWith('ss://')) p = parseSS(line);
    else if (line.startsWith('ssr://')) p = parseSSR(line);
    if (p && p.server && p.port) {
      const base = p.name;
      let i = 2;
      while (proxies.some(x => x.name === p.name)) p.name = `${base}#${i++}`;
      proxies.push(p);
    } else {
      errors += 1;
    }
  }
  return { proxies, errors };
}

function wrapProxies(proxies) {
  const proxyNames = proxies.map(p => p.name);
  const doc = {
    proxies,
    'proxy-groups': [
      { name: 'Proxy', type: 'select', proxies: ['DIRECT', ...proxyNames] },
      { name: 'Auto', type: 'url-test', proxies: proxyNames.length ? proxyNames : ['DIRECT'], url: 'http://www.gstatic.com/generate_204', interval: 300 }
    ],
    rules: [
      'DOMAIN-SUFFIX,local,DIRECT',
      'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
      'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
      'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
      'GEOIP,CN,DIRECT,no-resolve',
      'MATCH,Proxy',
    ],
  };
  return YAML.stringify(doc, { lineWidth: -1, noRefs: true });
}
// ===== End converter =====

module.exports = { b64decode, parseQuery, convertSubscription, wrapProxies };
