import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { databaseConfig } from '../src/config.ts';
import { hostedTarget, hostedRef, hostedOrigin } from './hosted-target.ts';
import { verify } from './verify.ts';
import { verifyHostedPublicAccess } from './verify-hosted-auth.ts';

const folder = fileURLToPath(new URL('../migrations', import.meta.url));
const envPath = fileURLToPath(new URL('../../../.env.hosted', import.meta.url));

async function management(
  environment: NodeJS.ProcessEnv,
  path: string,
  body?: object,
) {
  assert.ok(environment.SUPABASE_ACCESS_TOKEN);
  const response = await fetch(`https://api.supabase.com/v1${path}`, {
    method: body ? 'PATCH' : 'GET',
    headers: {
      Authorization: `Bearer ${environment.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });

  assert.equal(response.status, 200, 'Hosted management request refused.');
  return response.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const command = process.argv[2];
  assert.ok(
    process.argv.length === 3 &&
      ['inspect', 'migrate', 'verify', 'auth'].includes(command ?? ''),
    'Unknown hosted command.',
  );
  assert.equal(
    statSync(envPath).mode & 0o777,
    0o600,
    'Hosted credentials require mode 0600.',
  );
  const original = readFileSync(envPath, 'utf8');
  const environment: NodeJS.ProcessEnv = {
    ...parseEnv(original),
    HOSTED_AUTHORIZATION: process.env.HOSTED_AUTHORIZATION,
  };
  const target = hostedTarget(environment);
  const project = await management(environment, `/projects/${hostedRef}`);

  assert.equal(project.name, 'SwapCircle');
  assert.equal(project.id, hostedRef);
  assert.equal(project.status, 'ACTIVE_HEALTHY');
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const digest = createHash('sha256')
    .update(migrations.map((m) => m.hash).join('\n'))
    .digest('hex');
  const pool = new Pool({
    ...databaseConfig(target.href, false, environment),
    statement_timeout: 15_000,
    idleTimeoutMillis: 0,
  });

  try {
    assert.equal(
      (await pool.query('select current_user')).rows[0].current_user,
      'postgres',
    );
    if (command !== 'inspect') {
      assert.equal(
        (await pool.query('select pg_try_advisory_lock(749490049) as acquired'))
          .rows[0].acquired,
        true,
        'Another hosted operation is active.',
      );
    }
    const historyExists = (
      await pool.query(
        "select to_regclass('drizzle.__drizzle_migrations') as history",
      )
    ).rows[0].history;
    const history = historyExists
      ? (
          await pool.query(
            'select hash, created_at from drizzle.__drizzle_migrations order by id',
          )
        ).rows
      : [];

    assert.ok(
      history.length === 0 || history.length === migrations.length,
      'Partial hosted history requires separate review.',
    );
    history.forEach((row, i) => {
      assert.equal(row.hash, migrations[i]!.hash);
      assert.equal(Number(row.created_at), migrations[i]!.folderMillis);
    });

    if (!history.length) {
      const existing = await pool.query(
        "select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S','f')",
      );
      assert.equal(
        existing.rows[0].count,
        0,
        'Fresh hosted target contains unexpected objects.',
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')",
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (await pool.query('select count(*)::int as count from auth.users'))
          .rows[0].count,
        0,
      );
      assert.equal(
        (await pool.query('select count(*)::int as count from storage.objects'))
          .rows[0].count,
        0,
      );
      assert.equal(
        (await pool.query('select count(*)::int as count from storage.buckets'))
          .rows[0].count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from pg_roles where rolname='swapcircle_runtime'",
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as count from pg_publication_tables where pubname='supabase_realtime'",
          )
        ).rows[0].count,
        0,
      );
    }

    console.log(
      `Approved target verified; migration count ${history.length}; reviewed migration digest ${digest}.`,
    );
    if (command === 'inspect') return;

    if (command === 'migrate') {
      assert.equal(
        process.env.HOSTED_REVIEWED_MIGRATION_SHA256,
        digest,
        'Reviewed migration digest required.',
      );

      try {
        await migrate(drizzle(pool), { migrationsFolder: folder });
        if (!environment.DATABASE_URL) {
          const runtime = new URL(target);
          runtime.username = `swapcircle_runtime.${hostedRef}`;
          runtime.password = randomBytes(32).toString('hex');
          // Persist before provisioning, so retry never loses a generated credential.
          assert.equal(readFileSync(envPath, 'utf8'), original);
          assert.match(original, /^DATABASE_URL=\s*$/m);
          writeFileSync(
            envPath,
            original.replace(
              /^DATABASE_URL=\s*$/m,
              `DATABASE_URL=${runtime.href}`,
            ),
            { mode: 0o600 },
          );
          environment.DATABASE_URL = runtime.href;
        }
        const password = decodeURIComponent(
          new URL(environment.DATABASE_URL).password,
        );
        const quoted = await pool.query(
          'select quote_literal($1) as password',
          [password],
        );
        await pool.query(
          `ALTER ROLE swapcircle_runtime LOGIN PASSWORD ${quoted.rows[0].password}`,
        );
      } finally {
        await pool.query('select pg_advisory_unlock(749490049)');
      }
    }

    if (command === 'migrate' || command === 'verify') {
      assert.ok(environment.DATABASE_URL);
      await verify(pool, environment.DATABASE_URL, environment);
      assert.deepEqual(
        (
          await pool.query('select name from public.interests order by name')
        ).rows.map((r) => r.name),
        ['Books', 'Cooking', 'Gardening', 'Music', 'Outdoors', 'Repair'],
      );
      console.log(
        'Hosted permissions, baseline catalogue, Storage and Realtime verified.',
      );
    }

    if (command === 'auth') {
      assert.equal(history.length, migrations.length);
      assert.ok(
        environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET,
      );
      await management(environment, `/projects/${hostedRef}/config/auth`, {
        site_url: hostedOrigin,
        uri_allow_list: `${hostedOrigin}/auth/callback`,
        external_google_enabled: true,
        external_google_client_id: environment.GOOGLE_CLIENT_ID,
        external_google_secret: environment.GOOGLE_CLIENT_SECRET,
        external_google_skip_nonce_check: false,
        external_email_enabled: false,
        external_anonymous_users_enabled: false,
      });
      const auth = await management(
        environment,
        `/projects/${hostedRef}/config/auth`,
      );
      assert.equal(auth.site_url, hostedOrigin);
      assert.equal(auth.uri_allow_list, `${hostedOrigin}/auth/callback`);
      assert.equal(auth.external_google_enabled, true);
      assert.equal(auth.external_google_skip_nonce_check, false);
      assert.equal(
        auth.external_google_client_id,
        environment.GOOGLE_CLIENT_ID,
      );
      assert.equal(auth.external_email_enabled, false);
      assert.equal(auth.external_anonymous_users_enabled, false);
      await verifyHostedPublicAccess(environment);
      console.log(
        'Google provider and exact approved callback configured; human Google sign-in remains unverified.',
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error(
    'Hosted command refused or failed. Inspect target, authorization, reviewed history and private credentials; no provider error or secret was logged.',
  );
  process.exitCode = 1;
});
