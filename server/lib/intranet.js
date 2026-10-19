'use strict';
// Automatic intranet direct-connect rules.
//
// Corporate hosts may look public but resolve to private IPs through the
// corporate DNS. A fixed domain list is useful as a fast path, but it cannot
// cover every internal service. The automatic path is:
//   1. put the OS/corporate resolvers before public resolvers;
//   2. place private-CIDR rules immediately before MATCH WITHOUT no-resolve;
//      mihomo then resolves only traffic that fell through the profile rules,
//      detects 10/8 etc., and routes it DIRECT without a domain list.
//
// Known domains still go into nameserver-policy + fake-ip-filter for fast,
// deterministic handling. data/intranet.json can add domains or resolvers,
// but new split-horizon domains no longer require manual registration.
const fs = require('fs');
const fsp = fs.promises;
const dns = require('dns');
const net = require('net');
const path = require('path');
const { DATA_DIR } = require('../constants');
const { writeFileAtomic } = require('./atomic');

const INTRANET_FILE = 'intranet.json';

// Fallback for this corporate network when Node cannot expose the OS resolver
// list (the normal path is dns.getServers()).
const DEFAULT_NAMESERVERS = ['10.1.4.142', '10.1.4.141'];

const PRIVATE_CIDRS = [
    '127.0.0.0/8',
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
    '169.254.0.0/16',
    '100.64.0.0/10'
];

const DEFAULT_SUFFIXES = ['local', 'lan', 'internal', 'home.arpa', 'corp'];
const DEFAULT_DOMAINS = ['mychery.com', 'exeedcars.com'];

/** System DNS servers, filtered to usable IP literals. */
function detectSystemNameservers() {
    try {
        return dns.getServers().filter((server) => net.isIP(server));
    } catch {
        return [];
    }
}

function unique(values) {
    return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

/**
 * Read data/intranet.json, seeding it on first run. Existing files written by
 * older versions may lack nameservers; those automatically fall back to the
 * current OS resolvers and the known corporate defaults.
 */
async function loadIntranet(filePath = path.join(DATA_DIR, INTRANET_FILE)) {
    let parsed = null;
    try {
        parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch {
        // Missing or broken file: fall through to defaults.
    }

    const detected = detectSystemNameservers();
    if (!parsed || typeof parsed !== 'object') {
        parsed = {
            domains: DEFAULT_DOMAINS,
            suffixes: DEFAULT_SUFFIXES,
            extraCidrs: [],
            nameservers: unique([...detected, ...DEFAULT_NAMESERVERS])
        };
        await writeFileAtomic(filePath, JSON.stringify(parsed, null, 2));
        return parsed;
    }

    const configured = Array.isArray(parsed.nameservers) ? parsed.nameservers.filter(Boolean) : [];
    const nameservers = unique([...detected, ...configured, ...DEFAULT_NAMESERVERS]);
    // Self-heal legacy files so users can see/edit the effective resolvers.
    if (!Array.isArray(parsed.nameservers) || !parsed.nameservers.length) {
        await writeFileAtomic(filePath, JSON.stringify({
            ...parsed,
            nameservers
        }, null, 2));
    }

    return {
        domains: Array.isArray(parsed.domains) ? parsed.domains.filter(Boolean) : [...DEFAULT_DOMAINS],
        suffixes: Array.isArray(parsed.suffixes) ? parsed.suffixes.filter(Boolean) : [...DEFAULT_SUFFIXES],
        extraCidrs: Array.isArray(parsed.extraCidrs) ? parsed.extraCidrs.filter(Boolean) : [],
        nameservers
    };
}

/** Explicit domain rules: a fast path for known corporate zones. */
function domainDirectRules(intranet) {
    return [
        ...intranet.domains.map((domain) => `DOMAIN-SUFFIX,${domain},DIRECT`),
        ...intranet.suffixes.map((suffix) => `DOMAIN-SUFFIX,${suffix},DIRECT`)
    ];
}

/**
 * Automatic private-IP rules. Deliberately omit no-resolve: mihomo must resolve
 * a domain that falls through the profile rules in order to discover that its
 * destination is a private address.
 */
function privateDirectRules(intranet) {
    return [...PRIVATE_CIDRS, ...intranet.extraCidrs].map((cidr) => `IP-CIDR,${cidr},DIRECT`);
}

/** Complete intranet rule set, with automatic private-IP detection included. */
function intranetRules(intranet) {
    return [...domainDirectRules(intranet), ...privateDirectRules(intranet)];
}

/** Domains that should bypass fake-ip for deterministic real-IP resolution. */
function fakeIpFilterEntries(intranet) {
    return [
        ...intranet.domains.map((domain) => `+.${domain}`),
        ...intranet.suffixes.map((suffix) => `*.${suffix}`)
    ];
}

/**
 * Merge the intranet block into a config object.
 *
 * Known domain rules go first. Automatic private-CIDR rules are inserted just
 * before the first MATCH rule, so ordinary profile rules retain precedence and
 * only unmatched domains incur the extra DNS lookup.
 */
function applyIntranetToConfig(config, intranet) {
    const domainRules = domainDirectRules(intranet);
    const privateRules = privateDirectRules(intranet);
    const existingRules = Array.isArray(config.rules) ? config.rules : [];
    const existing = new Set(existingRules.map((r) => String(r).trim()));
    const missingDomains = domainRules.filter((r) => !existing.has(r));
    const rules = [...missingDomains, ...existingRules];
    const missingPrivate = privateRules.filter((r) => !rules.includes(r));
    const matchIndex = rules.findIndex((r) => /^MATCH,/i.test(String(r)));
    const insertAt = matchIndex >= 0 ? matchIndex : rules.length;
    rules.splice(insertAt, 0, ...missingPrivate);
    config.rules = rules;

    if (!config.dns || typeof config.dns !== 'object') config.dns = {};

    const fakeFilter = Array.isArray(config.dns['fake-ip-filter']) ? config.dns['fake-ip-filter'] : [];
    config.dns['fake-ip-filter'] = unique([...fakeFilter, ...fakeIpFilterEntries(intranet)]);

    // Corporate resolvers first, existing/public resolvers retained as fallback.
    const nameservers = Array.isArray(intranet.nameservers) ? unique(intranet.nameservers) : [];
    const existingNameservers = Array.isArray(config.dns.nameserver) ? config.dns.nameserver : [];
    if (nameservers.length) config.dns.nameserver = unique([...nameservers, ...existingNameservers]);

    // Known zones get an explicit policy; unknown split-horizon zones are
    // handled automatically by the private-CIDR rules above.
    if (nameservers.length) {
        const policy = (config.dns['nameserver-policy'] && typeof config.dns['nameserver-policy'] === 'object')
            ? config.dns['nameserver-policy']
            : {};
        for (const domain of [...intranet.domains, ...intranet.suffixes]) {
            if (!policy[`+.${domain}`]) policy[`+.${domain}`] = [...nameservers];
        }
        config.dns['nameserver-policy'] = policy;
    }
    return config;
}

module.exports = {
    INTRANET_FILE,
    PRIVATE_CIDRS,
    DEFAULT_SUFFIXES,
    DEFAULT_DOMAINS,
    DEFAULT_NAMESERVERS,
    detectSystemNameservers,
    loadIntranet,
    domainDirectRules,
    privateDirectRules,
    intranetRules,
    fakeIpFilterEntries,
    applyIntranetToConfig
};
