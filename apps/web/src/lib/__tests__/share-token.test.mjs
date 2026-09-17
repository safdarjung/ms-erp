// Public share-link tokens: sign, verify, and refuse everything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeShareToken, shareKey, verifyShareToken, KIND_SEG } from '../share-token.ts';

const key = shareKey('test-secret');
const other = shareKey('other-secret');
const TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DOC = '11111111-2222-4333-8444-555555555555';
const now = 1_800_000_000_000; // fixed clock
const exp = Math.floor(now / 1000) + 3600;

test('a signed token verifies and carries kind, id, tenant and expiry', () => {
  const tok = makeShareToken(key, 'quotation', DOC, TENANT, exp);
  const v = verifyShareToken(key, KIND_SEG.quotation, DOC, tok, now);
  assert.ok(v);
  assert.equal(v.kind, 'quotation');
  assert.equal(v.id, DOC);
  assert.equal(v.tenantId, TENANT);
  assert.equal(v.expiresAt.getTime(), exp * 1000);
  // Bill tokens use the short "b" segment.
  assert.ok(verifyShareToken(key, 'b', DOC, makeShareToken(key, 'invoice', DOC, TENANT, exp), now));
});

test('the id in the URL is matched case-insensitively', () => {
  const tok = makeShareToken(key, 'invoice', DOC, TENANT, exp);
  assert.ok(verifyShareToken(key, 'b', DOC.toUpperCase(), tok, now));
});

test('an expired token is refused', () => {
  const tok = makeShareToken(key, 'quotation', DOC, TENANT, exp);
  assert.equal(verifyShareToken(key, 'q', DOC, tok, exp * 1000 + 1), null);
});

test('a token for one document never opens another, nor another kind', () => {
  const tok = makeShareToken(key, 'quotation', DOC, TENANT, exp);
  assert.equal(verifyShareToken(key, 'q', '99999999-2222-4333-8444-555555555555', tok, now), null);
  assert.equal(verifyShareToken(key, 'b', DOC, tok, now), null);
  assert.equal(verifyShareToken(key, 'x', DOC, tok, now), null);
});

test('tampering with the tenant or expiry bytes breaks the signature', () => {
  const tok = makeShareToken(key, 'quotation', DOC, TENANT, exp);
  const raw = Buffer.from(tok, 'base64url');
  raw[0] ^= 0xff; // tenant
  assert.equal(verifyShareToken(key, 'q', DOC, raw.toString('base64url'), now), null);
  const raw2 = Buffer.from(tok, 'base64url');
  raw2.writeUInt32BE(exp + 86_400 * 365, 16); // extend expiry
  assert.equal(verifyShareToken(key, 'q', DOC, raw2.toString('base64url'), now), null);
});

test('a token signed with a different secret, or malformed, is refused', () => {
  const tok = makeShareToken(other, 'quotation', DOC, TENANT, exp);
  assert.equal(verifyShareToken(key, 'q', DOC, tok, now), null);
  assert.equal(verifyShareToken(key, 'q', DOC, 'not-a-token', now), null);
  assert.equal(verifyShareToken(key, 'q', DOC, '', now), null);
  assert.equal(verifyShareToken(key, 'q', 'not-a-uuid', tok, now), null);
});
