import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { assertDemoTarget } from '../src/features/development/demo-guard.js';
import { openJournal } from '../scripts/demo/journal.js';
import { listings, members, swaps } from '../scripts/demo/manifest.js';
import { listingCreateSchema } from '@swapcircle/contracts';

const localDatabase =
  'postgres://swapcircle_runtime:synthetic@127.0.0.1:55432/postgres';

for (const [environment, authUrl, database] of [
  ['production', 'http://127.0.0.1:55431', localDatabase],
  [undefined, 'http://127.0.0.1:55431', localDatabase],
  ['development', 'https://hosted.supabase.co', localDatabase],
  [
    'development',
    'http://127.0.0.1:55431',
    localDatabase.replace('55432', '5432'),
  ],
  ['development', 'http://127.0.0.1:55431', `${localDatabase}?sslmode=disable`],
  [
    'development',
    'http://127.0.0.1:55431',
    localDatabase.replace('swapcircle_runtime', 'postgres'),
  ],
  [
    'development',
    'http://127.0.0.1:55431',
    localDatabase.replace('127.0.0.1', 'localhost'),
  ],
] as const)
  test('demo refuses an unapproved environment or target', () => {
    expect(() => assertDemoTarget(environment, authUrl, database)).toThrow();
  });

test('journal resumes the same operation after failure and never repeats completed writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swapcircle-journal-'));
  const path = pathToFileURL(join(directory, 'state.json'));
  try {
    const journal = await openJournal(path);
    let firstKey = '';
    await expect(
      journal.step('trade', { scenario: 'books' }, z.string(), async (key) => {
        firstKey = key;
        throw new Error('Interrupted response');
      }),
    ).rejects.toThrow();
    const resumed = await openJournal(path);
    let calls = 0;
    expect(
      await resumed.step(
        'trade',
        { scenario: 'books' },
        z.string(),
        async (key) => {
          calls++;
          expect(key).toBe(firstKey);
          return 'saved';
        },
      ),
    ).toBe('saved');
    expect(
      await resumed.step(
        'trade',
        { scenario: 'books' },
        z.string(),
        async () => {
          calls++;
          return 'duplicate';
        },
      ),
    ).toBe('saved');
    expect(calls).toBe(1);
    await expect(
      resumed.step(
        'trade',
        { scenario: 'changed' },
        z.string(),
        async () => 'overwrite',
      ),
    ).rejects.toThrow('refusing to overwrite');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('demo manifest covers coherent ownership, real available interests and bundled images', async () => {
  expect(members).toHaveLength(10);
  expect(listings).toHaveLength(32);
  expect(new Set(listings.map((item) => item.key)).size).toBe(32);
  expect(listings.filter((item) => item.owner === 'guest')).toHaveLength(10);
  const catalogue = [
    'Books',
    'Cooking',
    'Gardening',
    'Music',
    'Outdoors',
    'Repair',
  ];
  for (const member of members)
    expect(
      member.interests.every((interest) => catalogue.includes(interest)),
    ).toBe(true);
  for (const item of listings) {
    const { images } = item;
    const fields = {
      title: item.title,
      description: item.description,
      condition: item.condition,
    };
    expect(listingCreateSchema.safeParse(fields).success).toBe(true);
    expect(images.length).toBeGreaterThan(0);
    expect(images.length).toBeLessThanOrEqual(3);
    for (const image of images)
      expect(
        (
          await readFile(
            new URL(
              `../../../packages/database/demo/assets/${image}.jpg`,
              import.meta.url,
            ),
          )
        ).length,
      ).toBeGreaterThan(1000);
  }
  const reserved = new Set<string>();
  for (const swap of swaps) {
    const owners = swap.items.map(
      (key) => listings.find((item) => item.key === key)?.owner,
    );
    expect(owners.every(Boolean)).toBe(true);
    expect(new Set(owners).size).toBe(owners.length);
    expect(owners).toContain(swap.creator);
    if (['confirmed', 'completed', 'disputed'].includes(swap.status))
      for (const item of swap.items) {
        expect(reserved.has(item)).toBe(false);
        reserved.add(item);
      }
  }
  expect(listings.length - reserved.size).toBeGreaterThan(20);
});

test('hosted demo guards reject other projects, elevated roles, transport overrides and local mode', async () => {
  const { assertHostedDemoTarget, hostedDemoAuth } =
    await import('../src/features/development/demo-guard.js');
  const database =
    'postgres://swapcircle_runtime.tpanyqfgmbpsiejqjocd:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
  expect(() =>
    assertHostedDemoTarget('production', hostedDemoAuth, database),
  ).not.toThrow();
  for (const target of [
    database.replace('swapcircle_runtime', 'postgres'),
    database.replace('5432', '6543'),
    `${database}?sslmode=disable`,
    database.replace('eu-west-1', 'eu-west-2'),
    localDatabase,
  ])
    expect(() =>
      assertHostedDemoTarget('production', hostedDemoAuth, target),
    ).toThrow();
  expect(() =>
    assertHostedDemoTarget('development', hostedDemoAuth, database),
  ).toThrow();
  expect(() =>
    assertHostedDemoTarget('production', 'https://other.supabase.co', database),
  ).toThrow();
});

test('production seed requires explicit authorization and fingerprints refuse edits or deletions', async () => {
  const { hostedSeedConfiguration, assertInventoryPreserved } =
    await import('../scripts/demo/hosted.js');
  const environment = {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://tpanyqfgmbpsiejqjocd.supabase.co',
    DATABASE_URL:
      'postgres://swapcircle_runtime.tpanyqfgmbpsiejqjocd:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    RENDER_API_URL: 'https://swapcircle-wqu8.onrender.com',
    FRONTEND_URL: 'https://swapcircle.pages.dev',
    DATABASE_CA_CERT_PATH: '/synthetic/verified-ca.crt',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
    SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
    DEMO_API_REVISION: 'a'.repeat(40),
    DEMO_SEED_AUTHORIZATION: 'approved-production-demo',
  };
  expect(() => hostedSeedConfiguration(environment)).not.toThrow();
  for (const override of [
    { DEMO_SEED_AUTHORIZATION: '' },
    { DEMO_API_REVISION: 'main' },
    { RENDER_API_URL: 'https://unapproved.invalid' },
    { FRONTEND_URL: 'http://localhost:5173' },
    { DATABASE_CA_CERT_PATH: '' },
  ])
    expect(() =>
      hostedSeedConfiguration({ ...environment, ...override }),
    ).toThrow();
  const saved = [{ table: 'messages', hashes: ['existing', 'existing'] }];
  expect(() =>
    assertInventoryPreserved(saved, [
      { table: 'messages', hashes: ['existing', 'existing', 'new'] },
    ]),
  ).not.toThrow();
  expect(() =>
    assertInventoryPreserved(saved, [
      { table: 'messages', hashes: ['existing', 'edited'] },
    ]),
  ).toThrow();
  expect(() => assertInventoryPreserved(saved, [])).toThrow();
});
