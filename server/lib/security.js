'use strict';
// Request guards for the local control console.
//
// The console binds to 127.0.0.1, which stops remote hosts but NOT a web page
// the user happens to have open: any site can issue a "simple" cross-origin
// POST to http://127.0.0.1:7891/api/stop and the browser will deliver it.
// Three independent checks close that hole:
//
//   1. Host must be a known local name  -> blocks DNS-rebinding hosts.
//   2. Origin/Referer, when present, must be the console's own origin
//      -> blocks cross-site form/img/fetch that carry either header.
//   3. State-changing methods additionally require a custom header
//      -> a cross-site request cannot set one without a CORS preflight,
//         which this server never answers.
//
// A browser always sends Origin on a cross-origin non-GET request and Referer
// on cross-origin subresource loads, so (2) covers the non-preflighted paths
// that (3) cannot reach.
const { ALLOWED_ORIGINS, ALLOWED_HOSTS } = require('../constants');

/** Header the front-end must set on every request it issues. */
const REQUEST_HEADER = 'x-console-request';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originAllowed(value) {
    if (!value) return false;
    try {
        return ALLOWED_ORIGINS.includes(new URL(value).origin);
    } catch {
        return false;
    }
}

function hostAllowed(value) {
    if (!value) return false;
    return ALLOWED_HOSTS.includes(value.trim().toLowerCase());
}

function refererAllowed(value) {
    if (!value) return false;
    try {
        return ALLOWED_ORIGINS.includes(new URL(value).origin);
    } catch {
        return false;
    }
}

/**
 * Decide whether a request may reach the API.
 * Returns null when allowed, otherwise a short reason string.
 */
function checkRequest({ method, headers }) {
    if (!hostAllowed(headers.host)) return 'bad-host';
    if (headers.origin !== undefined && !originAllowed(headers.origin)) return 'bad-origin';
    if (headers.origin === undefined && headers.referer !== undefined && !refererAllowed(headers.referer)) {
        return 'bad-referer';
    }
    if (MUTATING.has(String(method).toUpperCase()) && headers[REQUEST_HEADER] === undefined) {
        return 'missing-request-header';
    }
    return null;
}

/**
 * Express middleware enforcing checkRequest() on the API surface.
 * `onReject` receives (reason, req) for logging.
 */
function apiGuard(onReject) {
    return (req, res, next) => {
        const reason = checkRequest(req);
        if (reason) {
            if (onReject) onReject(reason, req);
            res.status(403).json({ success: false, error: `Forbidden (${reason})` });
            return;
        }
        next();
    };
}

/**
 * WebSocket upgrade guard. Browsers always send Origin on the handshake, so a
 * missing Origin is only accepted from non-browser clients on loopback.
 */
function checkUpgrade({ headers }) {
    if (!hostAllowed(headers.host)) return 'bad-host';
    if (headers.origin === undefined) return null;
    return originAllowed(headers.origin) ? null : 'bad-origin';
}

module.exports = { REQUEST_HEADER, checkRequest, apiGuard, checkUpgrade, originAllowed, hostAllowed };
