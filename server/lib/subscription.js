'use strict';
// Subscription fetching + share-link conversion. Moved verbatim from the
// previous single-file server; parsing behaviour is intentionally unchanged.
const { fetchAndConvertSub } = require('./subscription-fetch');
module.exports = { fetchAndConvertSub };
