import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, open, unlink } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import pino from 'pino';
import { z } from 'zod';
import { assertLocalRuntimeTarget, databaseConfig } from '@swapcircle/database';
import { listingSchema } from '@swapcircle/contracts';
import { createApp } from '../../dist/app.js';
import { createTokenVerifier } from '../../dist/auth/verify.js';
import { ListingsRepository } from '../../dist/features/listings/listings.repository.js';
import { ListingsService } from '../../dist/features/listings/listings.service.js';
import { hostedDemoApi } from '../../dist/features/development/demo-guard.js';
import { hostedSeedConfiguration, hostedReadiness } from './hosted.ts';
import { listings, members } from './manifest.ts';
import { prepareConditionChange } from './condition-refresh.ts';
import { openJournal, writePrivate } from './journal.ts';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((arg) => !['--production', '--apply'].includes(arg)) ||
    new Set(args).size !== args.length
  )
    throw new Error('Unexpected condition refresh arguments.');

  const hosted = args.includes('--production');
  const apply = args.includes('--apply');
  const root = new URL('../../../../', import.meta.url);
  const directory = new URL(
    `packages/database/${hosted ? '.demo.hosted.local' : '.demo.local'}/`,
    root,
  );
  let config: { API_URL: string; ANON_KEY: string };

  if (hosted) {
    config = hostedSeedConfiguration(process.env);
    await hostedReadiness(process.env);
  } else {
    assertLocalRuntimeTarget(process.env.DATABASE_URL, process.env.NODE_ENV);
    config = z
      .object({
        API_URL: z.literal('http://127.0.0.1:55431'),
        ANON_KEY: z.string(),
      })
      .parse(
        JSON.parse(
          execFileSync(
            'corepack',
            ['pnpm', 'exec', 'supabase', 'status', '-o', 'json'],
            {
              cwd: root,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          ),
        ),
      );
  }

  const credentials = z
    .object({
      authUrl: z.string(),
      accounts: z.array(
        z.object({
          key: z.string(),
          id: z.uuid(),
          email: z.email(),
          password: z.string(),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(new URL('credentials.json', directory), 'utf8'),
      ),
    );
  if (credentials.authUrl !== config.API_URL)
    throw new Error('Demo target mismatch.');

  // Share the seed lock: never race a seed or another refresh.
  const lockPath = new URL('seed.lock', directory);
  const lock = await open(lockPath, 'wx', 0o600);
  const pool = hosted
    ? undefined
    : new Pool(databaseConfig(process.env.DATABASE_URL));
  let server: import('node:http').Server | undefined;

  try {
    const journal = await openJournal(new URL('state.json', directory));
    const receipts = await openJournal(
      new URL('condition-refresh.json', directory),
    );
    let origin = hostedDemoApi;

    if (pool) {
      server = createApp({
        logger: pino({ level: 'silent' }),
        allowedOrigins: [],
        verifyToken: createTokenVerifier(config.API_URL, config.ANON_KEY),
        listings: new ListingsService(new ListingsRepository(pool)),
      }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('No local listener.');
      origin = `http://127.0.0.1:${address.port}`;
    }

    const actors = new Map<string, { id: string; token: string }>();
    for (const member of members) {
      const account = credentials.accounts.find(
        (entry) => entry.key === member.key,
      );
      if (!account) throw new Error('Missing demo identity.');

      const client = createClient(config.API_URL, config.ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = await client.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (
        login.error ||
        !login.data.session ||
        login.data.user.id !== account.id ||
        login.data.user.app_metadata.demo_seed !== 'swapcircle-v1' ||
        (hosted && login.data.user.app_metadata.demo_target !== config.API_URL)
      )
        throw new Error('Verified seeded identity required.');

      actors.set(member.key, {
        id: account.id,
        token: login.data.session.access_token,
      });
    }

    async function request(id: string, token: string, body?: unknown) {
      const response = await fetch(`${origin}/api/v1/listings/${id}`, {
        method: body ? 'PUT' : 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok)
        throw new Error(
          `Condition refresh refused (${response.status}); saved progress can be resumed.`,
        );

      return listingSchema.parse(await response.json());
    }

    const plan: {
      key: string;
      token: string;
      before: z.infer<typeof listingSchema>;
      input: {
        title: string;
        description: string;
        condition: (typeof listings)[number]['condition'];
        revision: number;
      };
    }[] = [];
    let unchanged = 0;
    for (const item of listings) {
      const record = journal.state.steps[`listing/${item.key}`];
      if (!record?.complete) throw new Error('A completed seed is required.');

      const saved = listingSchema.parse(record.result);
      const actor = actors.get(item.owner)!;
      const current = await request(saved.id, actor.token);
      const input = prepareConditionChange(current, saved, item, actor.id);
      if (!input) {
        unchanged++;
        continue;
      }

      plan.push({ key: item.key, token: actor.token, before: current, input });
    }

    console.info(
      `Condition refresh: ${plan.length} changes, ${unchanged} already matching; ${apply ? 'applying' : 'check only'}.`,
    );
    if (!apply) return;

    for (const entry of plan) {
      await writePrivate(
        new URL(`condition-before-${entry.key}.json`, directory),
        entry.before,
      );
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const result = await request(entry.before.id, entry.token, entry.input);
      await receipts.step(
        entry.key,
        entry.input,
        listingSchema,
        async () => result,
      );
      const verified = await request(entry.before.id, entry.token);
      if (
        verified.condition !== entry.input.condition ||
        verified.description !== entry.input.description ||
        verified.revision !== result.revision
      )
        throw new Error('Condition verification failed.');
    }
    console.info(
      'Demo conditions persisted and verified through the authenticated API.',
    );
  } finally {
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool?.end();
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch(() => {
  console.error(
    'Condition refresh stopped safely. Verify target, demo identities and unchanged seed records; no secrets were logged.',
  );
  process.exitCode = 1;
});
