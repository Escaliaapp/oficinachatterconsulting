import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from '../lib/chatter/connectors/crypto';
import { apolloSearchFilters } from '../lib/chatter/operations/icp';

test('connector credentials round-trip without plaintext and use fresh nonces', () => {
  const key = randomBytes(32).toString('hex');
  const values = { APOLLO_API_KEY: 'test-secret-not-a-real-key' };
  const encrypted = encryptCredentials(values, key, 'apollo');
  assert.ok(!encrypted.includes(values.APOLLO_API_KEY));
  assert.deepEqual(decryptCredentials(encrypted, key, 'apollo'), values);
  assert.notEqual(encryptCredentials(values, key, 'apollo'), encrypted);
});

test('credentials reject tampering, another connector and a different encryption key', () => {
  const key = randomBytes(32).toString('hex');
  const encrypted = encryptCredentials({ key: 'test' }, key, 'apollo');
  assert.throws(() => decryptCredentials(encrypted, key, 'google'));
  assert.throws(() => decryptCredentials(encrypted, randomBytes(32).toString('hex'), 'apollo'));
  const parts = encrypted.split('.');
  const altered = Buffer.from(parts[2], 'base64'); altered[0] ^= 1;
  parts[2] = altered.toString('base64');
  assert.throws(() => decryptCredentials(parts.join('.'), key, 'apollo'));
  assert.throws(() => encryptCredentials({}, 'short-key', 'apollo'));
});

test('Apollo uses supported keyword filters and bounded results, not the full instruction', () => {
  const filters = apolloSearchFilters('Busca 10 inmobiliarias en Ciudad de México', 'casas', 500);
  assert.equal(filters.q_keywords, 'casas');
  assert.equal(filters.per_page, 10);
  assert.deepEqual(filters.organization_locations, ['Ciudad de México']);
  assert.deepEqual(filters.person_locations, ['Mexico']);
  assert.equal(filters.include_similar_titles, false);
  assert.equal('included_organization_keyword_fields' in filters, false);
});
