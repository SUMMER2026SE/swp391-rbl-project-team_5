'use strict';

const {
  createOpaqueToken,
  hashPartyToken,
  tokensMatch,
} = require('../utils/partyToken');

describe('partyToken', () => {
  test('creates high-entropy URL-safe tokens and stores only a deterministic hash', () => {
    const token = createOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashPartyToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokensMatch(token, hashPartyToken(token))).toBe(true);
  });

  test('rejects a different token', () => {
    const token = createOpaqueToken();
    expect(tokensMatch(`${token}x`, hashPartyToken(token))).toBe(false);
  });
});
