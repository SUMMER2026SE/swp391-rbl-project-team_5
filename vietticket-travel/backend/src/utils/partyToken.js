'use strict';

const crypto = require('crypto');

const PARTY_TOKEN_HEADER = 'x-party-token';

function createOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashPartyToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function tokensMatch(rawToken, expectedHash) {
  const actual = Buffer.from(hashPartyToken(rawToken), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function readPartyToken(req) {
  return String(req?.headers?.[PARTY_TOKEN_HEADER] || '').trim();
}

module.exports = {
  PARTY_TOKEN_HEADER,
  createOpaqueToken,
  hashPartyToken,
  readPartyToken,
  tokensMatch,
};
