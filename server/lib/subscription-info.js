'use strict';
// Subscription-Userinfo response header parsing.
function parseSubscriptionInfo(headers) {
    const info = {};
    const raw = headers.get('subscription-userinfo');
    if (raw) {
        for (const part of raw.split(';')) {
            const [k, v] = part.trim().split('=');
            const value = Number(v);
            if (k && Number.isFinite(value)) info[k.trim().toLowerCase()] = value;
        }
    }
    const updateInterval = headers.get('profile-update-interval');
    if (updateInterval) info.updateInterval = Number(updateInterval);
    return info;
}

function hasSubscriptionInfo(info) {
    return ['upload', 'download', 'total', 'expire'].some(key => info[key] !== undefined);
}

module.exports = { parseSubscriptionInfo, hasSubscriptionInfo };
