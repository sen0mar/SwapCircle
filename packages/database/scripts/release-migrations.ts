import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { databaseConfig } from '../src/config.ts';
import { hostedTarget } from './hosted-target.ts';
import { verifiedHistoryPrefix } from './release-history.ts';

async function main() {
  assert.equal(
    process.env.DATABASE_URL,
    undefined,
    'Runtime credentials must not reach migrations.',
  );
  const target = hostedTarget(process.env);
  const folder = fileURLToPath(new URL('../migrations', import.meta.url));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const digest = createHash('sha256')
    .update(migrations.map((m) => m.hash).join('\n'))
    .digest('hex');

  // Routine releases are limited to the independently reviewed compatible history.
  // New/destructive migrations require a separate review and explicit digest update.
  assert.equal(
    digest,
    'a3b4e7945b9ce81257aa83344e2b7b77af0a243031e21396ef73a356122bd29d',
  );
  assert.equal(process.env.HOSTED_REVIEWED_MIGRATION_SHA256, digest);
  const pool = new Pool({
    ...databaseConfig(target.href, false),
    statement_timeout: 15_000,
    idleTimeoutMillis: 0,
  });

  try {
    assert.equal(
      (await pool.query('select current_user')).rows[0].current_user,
      'postgres',
    );
    assert.equal(
      (await pool.query('select pg_try_advisory_lock(749490049) as acquired'))
        .rows[0].acquired,
      true,
    );
    const history = (
      await pool.query(
        'select hash, created_at from drizzle.__drizzle_migrations order by id',
      )
    ).rows;

    verifiedHistoryPrefix(history, migrations);
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const applied = (
      await pool.query(
        'select hash, created_at from drizzle.__drizzle_migrations order by id',
      )
    ).rows;

    assert.equal(applied.length, migrations.length);
    verifiedHistoryPrefix(applied, migrations);
    console.log('Reviewed compatible Drizzle history verified and applied.');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    'Release migration refused or failed; target/history/credentials withheld.',
  );
  process.exitCode = 1;
});
