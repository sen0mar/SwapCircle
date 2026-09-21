import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalTarget, databaseConfig } from '../src/config.ts';

const local = 'postgresql://postgres:synthetic@127.0.0.1:55432/postgres';
test('local mutations require exact target and development/test opt-in', () => {
  assertLocalTarget(local, 'development');
  assertLocalTarget(local, 'test');
  for (const value of [
    undefined,
    '',
    local.replace('127.0.0.1', 'production.example'),
    local.replace('55432', '5432'),
    local + '?host=remote',
    local.replace('/postgres', '/other'),
    local.replace('postgres:', 'other:'),
  ]) {
    assert.throws(() => assertLocalTarget(value, 'test'));
  }
  for (const environment of [undefined, 'production', 'preview'])
    assert.throws(() => assertLocalTarget(local, environment));
});
test('runtime credentials are separate, pools bounded, remote TLS verified', () => {
  assert.throws(() => databaseConfig(local));
  const runtime = local.replace(
    'postgres:synthetic',
    'swapcircle_runtime:synthetic',
  );
  assert.equal(databaseConfig(runtime).max, 5);
  assert.equal(databaseConfig(runtime).ssl, false);
  assert.deepEqual(
    databaseConfig(runtime.replace('127.0.0.1', 'db.example')).ssl,
    { rejectUnauthorized: true },
  );
  assert.throws(() => databaseConfig(runtime + '?sslmode=disable'));
});
test('invalid and missing configuration fails without reflecting secrets', () => {
  for (const value of [
    undefined,
    'private-secret',
    'https://private-secret@example.com',
  ]) {
    assert.throws(
      () => databaseConfig(value),
      (error: Error) =>
        !error.message.includes('private-secret') &&
        error.message.includes('configuration'),
    );
  }
});
