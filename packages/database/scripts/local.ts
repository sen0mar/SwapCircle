import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import {
  assertLocalTarget,
  databaseConfig,
  DatabaseConfigurationError,
} from '../src/config.ts';
import { withLocalAuthConfig } from './auth-config.ts';
import { verify } from './verify.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

const migrationsFolder = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const command = process.argv[2];

function cli(args: string[], environment = process.env) {
  // Fixed workdir and argument lists: never accept --linked, --db-url, or user flags.
  return execFileSync('pnpm', ['exec', 'supabase', ...args], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function checkProject() {
  const config = readFileSync(`${root}supabase/config.toml`, 'utf8');

  if (
    !config.includes('project_id = "swapcircle-local"') ||
    !config.includes('port = 55432')
  ) {
    throw new DatabaseConfigurationError(
      'Unexpected local project configuration.',
    );
  }

  if (process.env.NODE_ENV === 'production')
    throw new DatabaseConfigurationError('Production environment refused.');

  if (process.argv.length !== 3)
    throw new DatabaseConfigurationError('Additional arguments refused.');
}

async function withMigration(run: (pool: Pool) => Promise<void>) {
  assertLocalTarget(process.env.MIGRATION_DATABASE_URL, process.env.NODE_ENV);

  const pool = new Pool(
    databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
  );

  try {
    await run(pool);
  } finally {
    await pool.end();
  }
}

async function apply(pool: Pool) {
  await migrate(drizzle(pool), { migrationsFolder });
}

async function provision(pool: Pool) {
  const runtime = process.env.DATABASE_URL;

  databaseConfig(runtime);

  const url = new URL(runtime!);

  if (url.hostname !== '127.0.0.1' || url.port !== '55432')
    throw new DatabaseConfigurationError('Runtime target must be local.');

  // quote_literal runs server-side; password never reaches logs or command arguments.
  const result = await pool.query<{ password: string }>(
    'select quote_literal($1) as password',
    [decodeURIComponent(url.password)],
  );

  await pool.query(
    `ALTER ROLE swapcircle_runtime LOGIN PASSWORD ${result.rows[0]!.password}`,
  );
}

async function seed(pool: Pool) {
  // Interest catalogue lives in the migration; no synthetic accounts or product data.
  await pool.query('select 1');
  console.log('Seed complete: no synthetic domain fixtures are defined.');
}

async function main() {
  checkProject();

  if (command === 'start') {
    withLocalAuthConfig(root, (environment) => cli(['start'], environment));
  } else if (command === 'stop') {
    cli(['stop']);
  } else if (command === 'setup') {
    const status = JSON.parse(cli(['status', '-o', 'json'])) as {
      DB_URL?: string;
    };

    assertLocalTarget(status.DB_URL, 'development');

    const runtime = new URL(status.DB_URL!);

    runtime.username = 'swapcircle_runtime';
    runtime.password = randomBytes(32).toString('hex');

    // Exclusive create: never silently replace an existing developer environment.
    writeFileSync(
      envPath,
      `NODE_ENV=development\nMIGRATION_DATABASE_URL=${status.DB_URL}\nDATABASE_URL=${runtime.href}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  } else if (command === 'reset') {
    assertLocalTarget(process.env.MIGRATION_DATABASE_URL, process.env.NODE_ENV);
    databaseConfig(process.env.DATABASE_URL);
    cli(['db', 'reset', '--local', '--no-seed', '--yes']);

    await withMigration(async (pool) => {
      await apply(pool);
      await provision(pool);
      await seed(pool);
      await verify(pool, process.env.DATABASE_URL!);
    });
  } else if (command === 'migrate') {
    await withMigration(async (pool) => {
      await apply(pool);
      await provision(pool);
    });
  } else if (command === 'seed') {
    await withMigration(seed);
  } else if (command === 'verify') {
    await withMigration(async (pool) => {
      await apply(pool);
      await verify(pool, process.env.DATABASE_URL!);
    });
  } else
    throw new DatabaseConfigurationError('Unknown local database command.');

  console.log(`Local database ${command} completed.`);
}

main().catch((error: unknown) => {
  // pg and CLI errors can contain connection strings/keys. Never echo them.
  console.error(
    error instanceof DatabaseConfigurationError
      ? error.message
      : 'Local database command failed. Check Docker, the isolated stack, and packages/database/.env (setup requires no existing .env). No credentials were logged.',
  );

  process.exitCode = 1;
});
