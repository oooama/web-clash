'use strict';
// Profile filename sanitising and path confinement.
const path = require('path');
const { PROFILES_DIR } = require('../constants');

function sanitizeProfileName(name) {
    if (typeof name !== 'string') return null;
    // Reject blank input and names made only of dots and whitespace: the
    // original turned '' into a file literally named ".yaml".
    //
    // Non-ASCII names are deliberately allowed. A Chinese provider name such
    // as 赔钱机场 sanitises to "____.yaml", which is a perfectly safe filename,
    // and requiring an ASCII character would reject it outright.
    const trimmed = name.trim();
    if (!trimmed || /^[.\s]*$/.test(trimmed)) return null;
    let safe = trimmed.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    if (!safe.endsWith('.yaml') && !safe.endsWith('.yml')) safe += '.yaml';
    const base = path.resolve(PROFILES_DIR);
    const resolved = path.resolve(base, safe);
    // Confinement check: the result must be a direct child of PROFILES_DIR.
    if (path.dirname(resolved) !== base) return null;
    return safe;
}

module.exports = { sanitizeProfileName };
