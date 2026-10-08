import { Pool } from 'pg';
import { databaseConfig } from '@swapcircle/database';
import { z } from 'zod';
import {
  assertHostedDemoTarget,
  hostedDemoApi,
  hostedDemoAuth,
  hostedDemoFrontend,
} from '../../dist/features/development/demo-guard.js';
import { writePrivate } from './journal.ts';
import { readFile } from 'node:fs/promises';

const inventorySchema = z.array(
  z.object({ table: z.string(), hashes: z.array(z.string()) }),
);

export function assertInventoryPreserved(
  saved: z.infer<typeof inventorySchema>,
  current: z.infer<typeof inventorySchema>,
) {
  for (const table of saved) {
    const counts = new Map<string, number>();
    for (const hash of current.find((t) => t.table === table.table)?.hashes ??
      [])
      counts.set(hash, (counts.get(hash) ?? 0) + 1);
    for (const hash of table.hashes) {
      if (!counts.get(hash))
        throw new Error(
          'A pre-existing record changed; inspect concurrent activity. No rollback performed.',
        );
      counts.set(hash, counts.get(hash)! - 1);
    }
  }
}

export function hostedSeedConfiguration(environment: NodeJS.ProcessEnv) {
  assertHostedDemoTarget(
    environment.NODE_ENV,
    environment.SUPABASE_URL ?? '',
    environment.DATABASE_URL,
  );
  if (
    environment.DEMO_SEED_AUTHORIZATION !== 'approved-production-demo' ||
    environment.RENDER_API_URL !== hostedDemoApi ||
    environment.FRONTEND_URL !== hostedDemoFrontend ||
    !environment.DATABASE_CA_CERT_PATH ||
    !/^[a-f0-9]{40}$/.test(environment.DEMO_API_REVISION ?? '') ||
    !environment.SUPABASE_SERVICE_ROLE_KEY ||
    !environment.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error('Approved hosted seed configuration required.');

  return {
    API_URL: hostedDemoAuth,
    SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
    ANON_KEY: environment.SUPABASE_PUBLISHABLE_KEY,
  } as const;
}

export async function hostedReadiness(environment: NodeJS.ProcessEnv) {
  hostedSeedConfiguration(environment);
  const response = await fetch(`${hostedDemoApi}/api/v1/ready`, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  const ready = z.object({
    status: z.literal('ready'),
    revision: z.literal(environment.DEMO_API_REVISION!),
  });
  if (!response.ok || !ready.safeParse(await response.json()).success)
    throw new Error('Approved deployed API revision is not ready.');
  const settings = await fetch(`${hostedDemoAuth}/auth/v1/settings`, {
    headers: { apikey: environment.SUPABASE_PUBLISHABLE_KEY! },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (
    !settings.ok ||
    !z
      .object({ external: z.object({ email: z.literal(true) }) })
      .safeParse(await settings.json()).success
  )
    throw new Error('Hosted password authentication is not enabled.');
}

// Read-only fingerprints provide evidence that pre-existing records were preserved.
// The runner never resets, restores, deletes or adopts them.
export async function hostedInventory(
  environment: NodeJS.ProcessEnv,
  path: URL,
  verify = false,
) {
  hostedSeedConfiguration(environment);
  const pool = new Pool({
    ...databaseConfig(environment.DATABASE_URL, true, environment),
    max: 1,
  });
  try {
    await pool.query('BEGIN READ ONLY');
    const role = (await pool.query('select current_user')).rows[0].current_user;
    if (role !== 'swapcircle_runtime')
      throw new Error('Unexpected database role.');
    const tables = (
      await pool.query<{ name: string; rls: boolean }>(
        `select c.relname name, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and not exists
       (select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e') order by c.relname`,
      )
    ).rows;
    if (tables.some((t) => !t.rls || !/^[a-z_]+$/.test(t.name)))
      throw new Error('Unexpected exposed table configuration.');
    const current = [];
    for (const table of tables) {
      const rows = (
        await pool.query<{ hash: string }>(
          `select md5(to_jsonb(t)::text) hash from public."${table.name}" t`,
        )
      ).rows;
      current.push({ table: table.name, hashes: rows.map((r) => r.hash) });
    }
    await pool.query('ROLLBACK');
    let saved: z.infer<typeof inventorySchema>;
    try {
      saved = inventorySchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || verify)
        throw error;
      await writePrivate(path, current);
      console.info(
        'Hosted read-only baseline saved; existing records will be preserved.',
      );
      return;
    }
    assertInventoryPreserved(saved, current);
    console.info('Pre-existing hosted records verified unchanged.');
  } finally {
    await pool.end();
  }
}
