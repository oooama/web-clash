'use strict';
// Intranet rule injection: corporate hosts that resolve to private IPs must be
// forced DIRECT, or a profile's own MATCH sends them to a remote node that
// cannot reach the corporate network. Two measured shapes on this machine:
//   gitlabqr.mychery.com   -> corporate DNS 10.2.1.163, public DNS NXDOMAIN
//   dmstest.exeedcars.com  -> corporate DNS 10.2.14.54, public DNS a DIFFERENT
//                             public address (61.191.217.232), i.e. a
//                             split-horizon zone that public DNS answers wrongly
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');
const {
    loadIntranet,
    intranetRules,
    fakeIpFilterEntries,
    applyIntranetToConfig,
    DEFAULT_DOMAINS
} = require('../server/lib/intranet');
const { wrapAggregate } = require('../server/lib/free-sources');

test('the seeded domain list covers every known corporate zone', () => {
    // Both are public-looking domains with internal split-horizon zones.
    assert.ok(DEFAULT_DOMAINS.includes('mychery.com'));
    assert.ok(DEFAULT_DOMAINS.includes('exeedcars.com'));
});

test('a split-horizon domain gets a DIRECT rule and the corporate resolver', () => {
    // dmstest.exeedcars.com resolves to a private address only via corporate
    // DNS; public DNS answers with an unrelated public IP, so without both the
    // rule and the resolver policy the request goes to the wrong host.
    const config = { rules: ['MATCH,Proxy'], dns: { nameserver: ['223.5.5.5'] } };
    applyIntranetToConfig(config, {
        domains: ['exeedcars.com'],
        suffixes: [],
        extraCidrs: [],
        nameservers: ['10.1.4.142', '10.1.4.141']
    });
    assert.strictEqual(config.rules[0], 'DOMAIN-SUFFIX,exeedcars.com,DIRECT');
    assert.deepStrictEqual(config.dns['nameserver-policy']['+.exeedcars.com'], ['10.1.4.142', '10.1.4.141']);
    assert.ok(config.dns['fake-ip-filter'].includes('+.exeedcars.com'));
});

test('intranetRules cover private CIDRs and configured domains', () => {
    const rules = intranetRules({ domains: ['mychery.com'], suffixes: ['local'], extraCidrs: ['203.0.113.0/24'] });
    assert.ok(rules.includes('DOMAIN-SUFFIX,mychery.com,DIRECT'));
    assert.ok(rules.includes('DOMAIN-SUFFIX,local,DIRECT'));
    // 10.2.1.163 (the measured corporate GitLab) must be covered.
    assert.ok(rules.includes('IP-CIDR,10.0.0.0/8,DIRECT'));
    assert.ok(rules.includes('IP-CIDR,192.168.0.0/16,DIRECT'));
    assert.ok(rules.includes('IP-CIDR,203.0.113.0/24,DIRECT'));
    assert.ok(!rules.some((r) => r === 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve'));
});

test('applyIntranetToConfig puts intranet rules ahead of the profile MATCH', () => {
    const config = {
        rules: ['DOMAIN-SUFFIX,google.com,Proxy', 'MATCH,一元机场'],
        dns: { 'fake-ip-filter': ['*.lan'] }
    };
    applyIntranetToConfig(config, { domains: ['mychery.com'], suffixes: ['local'], extraCidrs: [] });

    const idx = (needle) => config.rules.findIndex((r) => r === needle);
    assert.ok(idx('DOMAIN-SUFFIX,mychery.com,DIRECT') < idx('MATCH,一元机场'), 'intranet rule must precede MATCH');
    assert.ok(idx('IP-CIDR,10.0.0.0/8,DIRECT') < idx('MATCH,一元机场'));
    // The profile's own rules are preserved.
    assert.ok(config.rules.includes('DOMAIN-SUFFIX,google.com,Proxy'));
    // fake-ip-filter must bypass fake-ip for these domains, or the real private
    // address is never visible and the CIDR rules cannot match.
    assert.ok(config.dns['fake-ip-filter'].includes('+.mychery.com'));
    assert.ok(config.dns['fake-ip-filter'].includes('*.local'));
});

test('applyIntranetToConfig points intranet domains at the corporate resolvers', () => {
    // The core's own nameservers are public and answer NXDOMAIN for
    // intranet-only names, so a resolver policy is required or the DIRECT rule
    // has no address to connect to.
    const config = { rules: ['MATCH,Proxy'], dns: { nameserver: ['223.5.5.5'], 'nameserver-policy': { '+.existing.com': ['1.1.1.1'] } } };
    applyIntranetToConfig(config, {
        domains: ['mychery.com'],
        suffixes: ['internal'],
        extraCidrs: [],
        nameservers: ['10.1.4.142', '10.1.4.141']
    });
    assert.deepStrictEqual(config.dns['nameserver-policy']['+.mychery.com'], ['10.1.4.142', '10.1.4.141']);
    assert.deepStrictEqual(config.dns['nameserver-policy']['+.internal'], ['10.1.4.142', '10.1.4.141']);
    // Pre-existing policy entries survive.
    assert.deepStrictEqual(config.dns['nameserver-policy']['+.existing.com'], ['1.1.1.1']);
    // Corporate DNS is intentionally prepended; public resolvers remain as fallback.
    assert.deepStrictEqual(config.dns.nameserver, ['10.1.4.142', '10.1.4.141', '223.5.5.5']);
});

test('applyIntranetToConfig leaves dns alone when no corporate resolvers are set', () => {
    const config = { rules: [], dns: {} };
    applyIntranetToConfig(config, { domains: ['mychery.com'], suffixes: [], extraCidrs: [], nameservers: [] });
    assert.strictEqual(config.dns['nameserver-policy'], undefined);
});

test('applyIntranetToConfig does not duplicate rules it already added', () => {
    const intranet = { domains: ['mychery.com'], suffixes: [], extraCidrs: [] };
    const config = { rules: ['MATCH,Proxy'], dns: {} };
    applyIntranetToConfig(config, intranet);
    const first = config.rules.length;
    applyIntranetToConfig(config, intranet);
    assert.strictEqual(config.rules.length, first);
});

test('wrapAggregate carries the intranet block into the aggregate profile', () => {
    const doc = YAML.parse(wrapAggregate(
        [{ name: 'A', type: 'ss', server: '1.1.1.1', port: 443, cipher: 'aes-128-gcm', password: 'p' }],
        { domainRules: ['DOMAIN-SUFFIX,mychery.com,DIRECT'], privateRules: ['IP-CIDR,10.0.0.0/8,DIRECT'], fakeIpFilter: ['+.mychery.com'] }
    ));
    assert.strictEqual(doc.rules[0], 'DOMAIN-SUFFIX,mychery.com,DIRECT');
    assert.ok(doc.rules.includes('IP-CIDR,10.0.0.0/8,DIRECT'));
    assert.ok(!doc.rules.includes('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve'));
    assert.deepStrictEqual(doc.dns['fake-ip-filter'], ['+.mychery.com']);
});

test('loadIntranet seeds defaults once and honours edits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intranet-'));
    const file = path.join(dir, 'intranet.json');
    try {
        const first = await loadIntranet(file);
        assert.deepStrictEqual(first.domains, DEFAULT_DOMAINS);
        assert.ok(fs.existsSync(file));
        fs.writeFileSync(file, JSON.stringify({ domains: ['corp.example'], suffixes: [], extraCidrs: ['198.18.0.0/16'] }));
        const second = await loadIntranet(file);
        assert.deepStrictEqual(second.domains, ['corp.example']);
        assert.deepStrictEqual(second.extraCidrs, ['198.18.0.0/16']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
