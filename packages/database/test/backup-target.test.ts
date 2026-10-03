import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedHostedTarget } from '../scripts/backup-target.ts';

const ref = 'abcdefghijklmnopqrst';
const host = 'aws-0-eu-west-1.pooler.supabase.com';
const environment = {
  BACKUP_AUTHORIZATION: 'approved-hosted-export',
  BACKUP_MAINTENANCE_ACKNOWLEDGED: '1',
  BACKUP_APPROVED_PROJECT_REF: ref,
  BACKUP_APPROVED_DATABASE_HOST: host,
  BACKUP_DATABASE_URL: `postgresql://postgres.${ref}:synthetic@${host}:5432/postgres`,
  BACKUP_SUPABASE_URL: `https://${ref}.supabase.co`,
  BACKUP_SERVICE_ROLE_KEY: 'synthetic',
  BACKUP_CA_FILE: '/tmp/synthetic.crt',
};

test('hosted exports bind pooled/direct database and Storage to one approved project', () => {
  assert.equal(
    approvedHostedTarget(environment, 'database-export').hostname,
    host,
  );
  assert.throws(() =>
    approvedHostedTarget(
      {
        ...environment,
        BACKUP_DATABASE_URL: environment.BACKUP_DATABASE_URL.replace(
          ref,
          'zyxwvutsrqponmlkjihg',
        ),
      },
      'database-export',
    ),
  );
  assert.throws(() =>
    approvedHostedTarget(
      {
        ...environment,
        BACKUP_SUPABASE_URL: 'https://zyxwvutsrqponmlkjihg.supabase.co',
      },
      'storage-export',
    ),
  );
  const direct = `db.${ref}.supabase.co`;
  assert.equal(
    approvedHostedTarget(
      {
        ...environment,
        BACKUP_APPROVED_DATABASE_HOST: direct,
        BACKUP_DATABASE_URL: `postgresql://postgres:synthetic@${direct}:5432/postgres`,
      },
      'database-export',
    ).hostname,
    direct,
  );
});

test('hosted restore, unapproved hosts, missing offline acknowledgement and non-postgres database are refused', () => {
  assert.throws(() => approvedHostedTarget(environment, 'database-restore'));
  assert.throws(() => approvedHostedTarget(environment, 'storage-restore'));
  for (const changed of [
    { BACKUP_APPROVED_DATABASE_HOST: 'other.invalid' },
    { BACKUP_MAINTENANCE_ACKNOWLEDGED: '0' },
    { BACKUP_CA_FILE: '' },
    {
      BACKUP_DATABASE_URL: environment.BACKUP_DATABASE_URL.replace(
        '/postgres',
        '/other',
      ),
    },
  ])
    assert.throws(() =>
      approvedHostedTarget({ ...environment, ...changed }, 'database-export'),
    );
});
