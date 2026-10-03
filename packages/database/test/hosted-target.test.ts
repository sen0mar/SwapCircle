import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'swapcircle-hosted-'));
const ca = join(directory, 'ca.crt');
writeFileSync(ca, 'synthetic');
after(() => rmSync(directory, { recursive: true }));
import {
  hostedTarget,
  hostedRef,
  hostedOrigin,
} from '../scripts/hosted-target.ts';

const environment = {
  HOSTED_AUTHORIZATION: 'configure-approved-project',
  SUPABASE_URL: `https://${hostedRef}.supabase.co`,
  FRONTEND_URL: hostedOrigin,
  DATABASE_CA_CERT_PATH: ca,
  MIGRATION_DATABASE_URL: `postgresql://postgres.${hostedRef}:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
};

test('hosted operations refuse missing authorization and mismatched targets before connecting', () => {
  assert.equal(
    hostedTarget(environment).hostname,
    'aws-0-eu-west-1.pooler.supabase.com',
  );
  for (const override of [
    { HOSTED_AUTHORIZATION: undefined },
    { SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' },
    { FRONTEND_URL: 'https://preview.pages.dev' },
    { DATABASE_CA_CERT_PATH: undefined },
    {
      MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL.replace(
        '5432',
        '6543',
      ),
    },
    {
      MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL.replace(
        hostedRef,
        'aaaaaaaaaaaaaaaaaaaa',
      ),
    },
  ])
    assert.throws(() => hostedTarget({ ...environment, ...override }));
});

test('runtime provisioning requires separate role, password and exact project target', () => {
  const runtime = environment.MIGRATION_DATABASE_URL.replace(
    'postgres.',
    'swapcircle_runtime.',
  ).replace(':synthetic@', ':separate@');
  hostedTarget({ ...environment, DATABASE_URL: runtime });

  for (const value of [
    environment.MIGRATION_DATABASE_URL,
    runtime.replace('separate', 'synthetic'),
    runtime.replace('eu-west-1', 'eu-west-2'),
    runtime.replace(hostedRef, 'aaaaaaaaaaaaaaaaaaaa'),
  ]) {
    assert.throws(() => hostedTarget({ ...environment, DATABASE_URL: value }));
  }
});
