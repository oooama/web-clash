'use strict';
// Single source of truth for ports and on-disk locations.
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');

const PORT = 7891;
const CLASH_API_PORT = 9090;
// 7892 rather than the conventional 7890: a previously killed mihomo left a
// zombie UDP socket bound to 7890 on this machine, and the mixed port needs
// both TCP and UDP. Reclaiming 7890 requires a reboot.
const MIXED_PORT = 7892;

const MIHOMO_RUN = path.join(BIN_DIR, 'mihomo-run.exe');
const CONFIG_PATH = path.join(DATA_DIR, 'config.yaml');
const PROFILE_META = path.join(ROOT_DIR, 'profile-meta.json');
const CORE_PID_FILE = path.join(DATA_DIR, 'core.pid');

/** Host names the console accepts; used by the origin/host guards. */
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];
/** Accepted values of the Origin / Host headers. */
const ALLOWED_ORIGINS = ALLOWED_HOSTNAMES.map((h) => `http://${h}:${PORT}`);
const ALLOWED_HOSTS = ALLOWED_HOSTNAMES.map((h) => `${h}:${PORT}`);

module.exports = {
    ROOT_DIR,
    BIN_DIR,
    DATA_DIR,
    PUBLIC_DIR,
    PROFILES_DIR,
    PORT,
    CLASH_API_PORT,
    MIXED_PORT,
    MIHOMO_RUN,
    CONFIG_PATH,
    PROFILE_META,
    CORE_PID_FILE,
    ALLOWED_HOSTNAMES,
    ALLOWED_ORIGINS,
    ALLOWED_HOSTS
};
