'use strict';
// Behaviour lock for the share-link converter. These cases pin the parsing
// that was moved verbatim out of the old single-file server, so a future
// refactor cannot silently change subscription handling.
const test = require('node:test');
const assert = require('node:assert');
const { convertSubscription, wrapProxies, b64decode } = require('../server/lib/subscription-convert');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function vmessLink(overrides = {}) {
    const payload = {
        v: '2',
        ps: 'vmess-node',
        add: '1.2.3.4',
        port: '443',
        id: '11111111-2222-3333-4444-555555555555',
        aid: '0',
        scy: 'auto',
        net: 'ws',
        type: 'none',
        host: 'cdn.example.com',
        path: '/ws',
        tls: 'tls',
        sni: 'cdn.example.com',
        ...overrides
    };
    return 'vmess://' + b64(JSON.stringify(payload));
}

test('b64decode accepts both standard and URL-safe alphabets', () => {
    assert.strictEqual(b64decode(b64('hello world')), 'hello world');
    assert.strictEqual(b64decode(b64('a?b>c').replace(/\+/g, '-').replace(/\//g, '_')), 'a?b>c');
});

test('parses a vmess link with ws + tls options', () => {
    const { proxies, errors } = convertSubscription(vmessLink());
    assert.strictEqual(errors, 0);
    assert.strictEqual(proxies.length, 1);
    const p = proxies[0];
    assert.strictEqual(p.type, 'vmess');
    assert.strictEqual(p.server, '1.2.3.4');
    assert.strictEqual(p.port, 443);
    assert.strictEqual(p.name, 'vmess-node');
    assert.strictEqual(p.tls, true);
    assert.strictEqual(p.servername, 'cdn.example.com');
    assert.strictEqual(p.network, 'ws');
    assert.deepStrictEqual(p['ws-opts'], { path: '/ws', headers: { Host: 'cdn.example.com' } });
});

test('parses a vless link with reality options', () => {
    const link =
        'vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443' +
        '?type=tcp&security=reality&pbk=PUBKEY&sid=abcd&sni=www.example.com&flow=xtls-rprx-vision#VlessNode';
    const { proxies, errors } = convertSubscription(link);
    assert.strictEqual(errors, 0);
    assert.strictEqual(proxies.length, 1);
    const p = proxies[0];
    assert.strictEqual(p.name, 'VlessNode');
    assert.strictEqual(p.uuid, '11111111-2222-3333-4444-555555555555');
    assert.strictEqual(p.flow, 'xtls-rprx-vision');
    assert.strictEqual(p.tls, true);
    assert.deepStrictEqual(p['reality-opts'], { 'public-key': 'PUBKEY', 'short-id': 'abcd' });
    assert.strictEqual(p.servername, 'www.example.com');
    assert.strictEqual(p.network, undefined, 'tcp must not be written as a network override');
});

test('parses a vless grpc link', () => {
    const link = 'vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443?type=grpc&serviceName=svc#GrpcNode';
    const { proxies } = convertSubscription(link);
    assert.deepStrictEqual(proxies[0]['grpc-opts'], { 'grpc-service-name': 'svc' });
});

test('parses a trojan link and decodes an escaped password', () => {
    const link = 'trojan://p%3Ass@1.2.3.4:443?sni=a.example&allowInsecure=1&type=ws&path=%2Fws&host=h.example#TrojanNode';
    const { proxies, errors } = convertSubscription(link);
    assert.strictEqual(errors, 0);
    const p = proxies[0];
    assert.strictEqual(p.type, 'trojan');
    assert.strictEqual(p.password, 'p:ss');
    assert.strictEqual(p.sni, 'a.example');
    assert.strictEqual(p['skip-cert-verify'], true);
    assert.deepStrictEqual(p['ws-opts'], { path: '/ws', headers: { Host: 'h.example' } });
});

test('parses a shadowsocks link with base64 userinfo', () => {
    const link = 'ss://' + b64('aes-256-gcm:secret') + '@1.2.3.4:8388#SSOne';
    const { proxies, errors } = convertSubscription(link);
    assert.strictEqual(errors, 0);
    const p = proxies[0];
    assert.strictEqual(p.type, 'ss');
    assert.strictEqual(p.cipher, 'aes-256-gcm');
    assert.strictEqual(p.password, 'secret');
    assert.strictEqual(p.server, '1.2.3.4');
    assert.strictEqual(p.port, 8388);
    assert.strictEqual(p.name, 'SSOne');
});

test('parses a fully base64 shadowsocks link and keeps the plugin', () => {
    const link = 'ss://' + b64('aes-256-gcm:secret@1.2.3.4:8388') + '?plugin=obfs-local%3Bobfs%3Dhttp#SSTwo';
    const { proxies, errors } = convertSubscription(link);
    assert.strictEqual(errors, 0);
    const p = proxies[0];
    assert.strictEqual(p.password, 'secret');
    assert.strictEqual(p.plugin, 'obfs-local;obfs=http');
});

test('parses an ssr link', () => {
    const body = ['1.2.3.4', '8388', 'auth_aes128_md5', 'aes-256-cfb', 'tls1.2_ticket_auth', b64('pass')].join(':');
    const link = 'ssr://' + b64(`${body}/?remarks=${b64('SSRNode')}&obfsparam=&protoparam=`);
    const { proxies, errors } = convertSubscription(link);
    assert.strictEqual(errors, 0);
    const p = proxies[0];
    assert.strictEqual(p.type, 'ssr');
    assert.strictEqual(p.name, 'SSRNode');
    assert.strictEqual(p.password, 'pass');
    assert.strictEqual(p.protocol, 'auth_aes128_md5');
    assert.strictEqual(p.obfs, 'tls1.2_ticket_auth');
});
test('node names never keep the URL fragment marker', () => {
    // URL.hash includes the leading '#'; vless/trojan names used to render as
    // "#Node" while ss/ssr/vmess were clean.
    const cases = [
        ['vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443?type=tcp#VlessNode', 'VlessNode'],
        ['trojan://pw@1.2.3.4:443#TrojanNode', 'TrojanNode'],
        ['ss://' + b64('aes-256-gcm:pw') + '@1.2.3.4:8388#SsNode', 'SsNode']
    ];
    for (const [link, expected] of cases) {
        const { proxies } = convertSubscription(link);
        assert.strictEqual(proxies[0].name, expected, link.slice(0, 20));
        assert.ok(!proxies[0].name.startsWith('#'));
    }
});

test('a percent-encoded fragment name is decoded and stripped once', () => {
    const link = 'trojan://pw@1.2.3.4:443#%E4%B8%80%E5%85%83%20250';
    const { proxies } = convertSubscription(link);
    assert.strictEqual(proxies[0].name, '一元 250');
});
test('parses a whole base64-encoded subscription body', () => {
    const plain = [vmessLink({ ps: 'A' }), 'trojan://pw@5.6.7.8:443#B'].join('\n');
    const { proxies, errors } = convertSubscription(b64(plain));
    assert.strictEqual(errors, 0);
    assert.deepStrictEqual(proxies.map((p) => p.name), ['A', 'B']);
});

test('de-duplicates repeated node names', () => {
    const { proxies } = convertSubscription([vmessLink({ ps: 'dup' }), vmessLink({ ps: 'dup' }), vmessLink({ ps: 'dup' })].join('\n'));
    assert.deepStrictEqual(proxies.map((p) => p.name), ['dup', 'dup#2', 'dup#3']);
});

test('counts unparseable lines as errors instead of throwing', () => {
    const { proxies, errors } = convertSubscription('vmess://not-valid-base64!!\n# comment\n');
    assert.strictEqual(proxies.length, 0);
    assert.strictEqual(errors, 2);
});

test('detects a body that is already a clash YAML document', () => {
    const { alreadyYaml, proxies } = convertSubscription('proxies:\n  - name: x\n    type: ss\n');
    assert.strictEqual(alreadyYaml, true);
    assert.strictEqual(proxies.length, 0);
});

test('drops links with no server or port', () => {
    const { proxies, errors } = convertSubscription('vless://uuid@:0?type=tcp#broken');
    assert.strictEqual(proxies.length, 0);
    assert.strictEqual(errors, 1);
});

test('wrapProxies emits a bootable rule-mode document', () => {
    const { proxies } = convertSubscription([vmessLink({ ps: 'n1' }), vmessLink({ ps: 'n2' })].join('\n'));
    const yaml = wrapProxies(proxies);
    assert.match(yaml, /proxy-groups:/);
    assert.match(yaml, /- n1/);
    assert.match(yaml, /MATCH,Proxy/);
    assert.match(yaml, /GEOIP,CN,DIRECT/);
});
