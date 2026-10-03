import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertLocalRuntimeTarget,
  assertLocalTarget,
  databaseConfig,
} from '../src/config.ts';

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

test('cleanup guards the actual runtime target independently of local migration credentials', () => {
  assertLocalTarget(local, 'development');
  const runtime = local.replace(
    'postgres:synthetic',
    'swapcircle_runtime:synthetic',
  );
  assertLocalRuntimeTarget(runtime, 'development');
  assert.throws(() =>
    assertLocalRuntimeTarget(
      runtime.replace('127.0.0.1', 'db.hosted.example'),
      'development',
    ),
  );
  assert.throws(() =>
    assertLocalRuntimeTarget(runtime.replace('55432', '5432'), 'development'),
  );
  assert.throws(() => assertLocalRuntimeTarget(runtime, 'production'));
  assert.throws(() => assertLocalRuntimeTarget(local, 'development'));
});

test('hosted session runtime binds the username to the Supabase project and pooler', () => {
  const ref = 'tpanyqfgmbpsiejqjocd';
  const value = `postgresql://swapcircle_runtime.${ref}:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;
  const environment = { SUPABASE_URL: `https://${ref}.supabase.co` };

  assert.equal(databaseConfig(value, true, environment).max, 5);
  assert.deepEqual(databaseConfig(value, true, environment).ssl, {
    rejectUnauthorized: true,
  });

  for (const invalid of [
    value.replace('5432', '6543'),
    value.replace(
      'aws-0-eu-west-1.pooler.supabase.com',
      'evil.pooler.supabase.com',
    ),
    value.replace(ref, 'aaaaaaaaaaaaaaaaaaaa'),
    value.replace('swapcircle_runtime', 'postgres'),
  ]) {
    assert.throws(() => databaseConfig(invalid, true, environment));
  }

  assert.throws(() => databaseConfig(value, true, {}));
  assert.throws(() => assertLocalRuntimeTarget(value, 'test'));
  assert.throws(() => assertLocalTarget(value, 'test'));
});
