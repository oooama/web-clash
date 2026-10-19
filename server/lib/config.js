'use strict';
// mihomo config access.
//
// The old server carried two overlapping config builders: an unused
// generateConfig(profile) holding the good defaults (dns, sniffer, tcp
// settings) and a minimal literal repeated in three places for the bootstrap,
// delete-active and apply paths. defaultConfig() is now the single baseline and
// carries the full default set; generateConfig is gone.
const fs = require('fs');
const fsp = fs.promises;
const YAML = require('yaml');
const { CONFIG_PATH, MIXED_PORT, CLASH_API_PORT } = require('../constants');
const { writeFileAtomic } = require('./atomic');

const MODES = ['rule', 'global', 'direct'];

const DEFAULT_RULES = [
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'GEOIP,CN,DIRECT,no-resolve',
    'MATCH,Proxy'
];

/** Baseline config used when no profile supplies its own groups and rules. */
function defaultConfig() {
    return {
        'mixed-port': MIXED_PORT,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        ipv6: false,
        'external-controller': `127.0.0.1:${CLASH_API_PORT}`,
        'find-process-mode': 'strict',
        'tcp-concurrent': true,
        'geodata-mode': true,
        'geodata-loader': 'standard',
        tun: { enable: false },
        dns: {
            enable: true,
            ipv6: false,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'fake-ip-filter': ['*.lan', '*.local', '+.msftconnecttest.com', '+.msftncsi.com'],
            'default-nameserver': ['223.5.5.5', '1.12.12.12'],
            nameserver: ['223.5.5.5', '1.12.12.12'],
            fallback: ['8.8.8.8', '1.1.1.1'],
            'fallback-filter': { geoip: true, 'geoip-code': 'CN' }
        },
        sniffer: {
            enable: true,
            'force-dns-mapping': true,
            'parse-pure-ip': true,
            sniff: {
                HTTP: { ports: [80, '8080-8880'], 'override-destination': true },
                TLS: { ports: [443, 8443] },
                QUIC: { ports: [443, 8443] }
            }
        },
        profile: { 'store-selected': true },
        proxies: [],
        'proxy-groups': [
            { name: 'Proxy', type: 'select', proxies: ['DIRECT'] },
            {
                name: 'Auto',
                type: 'url-test',
                proxies: ['DIRECT'],
                url: 'http://www.gstatic.com/generate_204',
                interval: 300
            }
        ],
        rules: [...DEFAULT_RULES]
    };
}

/** Read the on-disk config, or null when it is missing or unparseable. */
async function readConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return null;
        return YAML.parse(await fsp.readFile(CONFIG_PATH, 'utf8'));
    } catch {
        return null;
    }
}

/** Atomically persist a config object. */
async function writeConfig(config) {
    await writeFileAtomic(CONFIG_PATH, YAML.stringify(config));
    return config;
}

/** Normalise an outbound mode value; null when it is not one of the three. */
function normalizeMode(value) {
    const mode = String(value == null ? '' : value).trim().toLowerCase();
    return MODES.includes(mode) ? mode : null;
}

/**
 * Copy of `config` with a validated mode applied, or null for an unknown mode.
 * Returning a copy keeps the caller's object (often a cached read) untouched.
 */
function withMode(config, value) {
    const mode = normalizeMode(value);
    if (!mode) return null;
    return { ...config, mode };
}

module.exports = { defaultConfig, DEFAULT_RULES, MODES, normalizeMode, withMode, readConfig, writeConfig };
