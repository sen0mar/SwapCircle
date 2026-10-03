// Actual encrypted SQL + Storage roundtrip; synthetic guarded local stack only.
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';
import { PhotosRepository } from '../../api/dist/features/photos/photos.repository.js';
import { PhotosService } from '../../api/dist/features/photos/photos.service.js';
import { initializeMonitoring } from '../../api/dist/observability/sentry.js';

const fetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4212';
const apiOrigin = 'http://127.0.0.1:4332';
const fixture = await createDiscoveryFixture(origin);
const [alice, bob] = fixture.users;
const privateDirectory = await mkdtemp(join(tmpdir(), 'swapcircle-recovery-'));
const evidence = new URL('../test-results/backup-local/', import.meta.url);
const key = join(privateDirectory, 'key');
const database = join(privateDirectory, 'database.enc');
const storage = join(privateDirectory, 'storage.enc');
const backupEnv = {
  ...process.env,
  BACKUP_LOCAL_MAINTENANCE: 'synthetic-offline',
  BACKUP_KEY_FILE: key,
};
let server;
let preview;
let browser;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const operate = (command, path, overrides = {}) =>
  execFileSync('pnpm', ['backup', command], {
    cwd: new URL('../../../packages/database', import.meta.url),
    env: { ...backupEnv, BACKUP_FILE: path, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const api = async (path, user, body, method = 'GET') => {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `Local API status ${response.status}`);
  return response.json();
};
try {
  server = fixture.app.listen(4332, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  for (const [user, name] of [
    [alice, 'Recovery Alice'],
    [bob, 'Recovery Bob'],
  ])
    await api(
      '/profiles/me',
      user,
      {
        displayName: name,
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
  const items = [];
  for (const [user, title] of [
    [alice, 'Restored camera'],
    [bob, 'Restored backpack'],
  ]) {
    const item = await api(
      '/listings',
      user,
      { title, description: 'Synthetic recovery fixture', condition: 'good' },
      'POST',
    );
    items.push(item);
  }
  const image = await readFile(
    new URL('../src/assets/backpack.jpg', import.meta.url),
  );
  const photoResponse = await fetch(
    `${apiOrigin}/api/v1/listings/${items[0].id}/photos`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${alice.token}`,
        'Content-Type': 'image/jpeg',
      },
      body: image,
    },
  );
  assert.equal(photoResponse.status, 201);
  const photo = await photoResponse.json();
  const imageHash = hash(
    Buffer.from(await (await fetch(photo.url)).arrayBuffer()),
  );
  const trade = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: [alice.id, bob.id],
      transfers: items.map((item, i) => ({
        listingId: item.id,
        ownerId: [alice, bob][i].id,
        recipientId: [bob, alice][i].id,
      })),
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    'POST',
  );
  await api(
    `/trades/${trade.id}/cancel`,
    alice,
    { expectedVersion: 1 },
    'POST',
  );
  const conversation = await api(
    '/conversations/direct',
    alice,
    { userId: bob.id },
    'POST',
  );
  await api(
    '/conversations/messages',
    alice,
    {
      conversation_id: conversation.id,
      client_message_id: randomUUID(),
      body: 'Synthetic message restored from encrypted export.',
    },
    'POST',
  );
  const historyBefore = await api(`/trades/${trade.id}`, alice);
  const counts = async () =>
    (
      await fixture.migration
        .query(`SELECT (SELECT count(*) FROM auth.users)::int AS accounts,
    (SELECT count(*) FROM public.profiles)::int AS profiles, (SELECT count(*) FROM public.listings)::int AS listings,
    (SELECT count(*) FROM public.messages)::int AS messages, (SELECT count(*) FROM public.trade_events)::int AS events`)
    ).rows[0];
  const before = await counts();
  await new Promise((done) => server.close(done));
  server = undefined;
  operate('key');
  operate('database-export', database);
  operate('storage-export', storage);
  assert.ok(
    !(await readFile(database)).includes(
      Buffer.from('Synthetic message restored'),
    ),
  );
  assert.ok(!(await readFile(storage)).includes(image));
  const wrongKey = join(privateDirectory, 'wrong-key');
  await writeFile(wrongKey, Buffer.alloc(32), { mode: 0o600 });
  assert.throws(() =>
    operate('database-restore', database, { BACKUP_KEY_FILE: wrongKey }),
  );
  assert.deepEqual(await counts(), before);
  const objectRows = (
    await fixture.migration.query(
      "SELECT name FROM storage.objects WHERE bucket_id='item-media'",
    )
  ).rows;
  for (const row of objectRows) await fixture.storage.remove(row.name);
  assert.equal((await fetch(photo.url)).ok, false);
  await fixture.migration.query('TRUNCATE public.profiles, auth.users CASCADE');
  const empty = await counts();
  for (const name of ['accounts', 'profiles', 'listings', 'messages', 'events'])
    assert.equal(empty[name], 0);
  operate('database-restore', database);
  assert.deepEqual(await counts(), before);
  assert.equal(
    (await fetch(photo.url)).ok,
    false,
    'SQL restore must not pretend to restore object bytes.',
  );
  operate('storage-restore', storage);
  assert.equal(
    hash(Buffer.from(await (await fetch(photo.url)).arrayBuffer())),
    imageHash,
  );
  const authReferences = await fixture.migration.query(
    'SELECT p.id FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL',
  );
  assert.equal(authReferences.rowCount, 0);
  const status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const restoredUser = await admin.auth.admin.getUserById(alice.id);
  assert.equal(restoredUser.error, null);
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: restoredUser.data.user.email,
  });
  assert.equal(link.error, null);
  const login = await createClient(
    status.API_URL,
    status.ANON_KEY,
    options,
  ).auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.data.properties.hashed_token,
  });
  assert.equal(login.error, null);
  assert.equal(login.data.user.id, alice.id);
  alice.session = login.data.session;
  alice.token = login.data.session.access_token;
  server = fixture.app.listen(4332, '127.0.0.1');
  await new Promise((done) => server.once('listening', done));
  assert.deepEqual(await api(`/trades/${trade.id}`, alice), historyBefore);
  // Historical photos remain usable even on an available cancelled listing.
  assert.equal(
    (
      await fetch(
        `${apiOrigin}/api/v1/listings/${items[0].id}/photos/${photo.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${alice.token}` },
        },
      )
    ).status,
    409,
  );
  const cleanListing = items[1];
  const fresh = await api(
    '/listings',
    alice,
    {
      title: 'Cleanup fixture',
      description: 'Synthetic cleanup item',
      condition: 'good',
    },
    'POST',
  );
  const reserve = async (position, age) =>
    (
      await fixture.migration.query(
        `INSERT INTO public.listing_photos
    (listing_id, owner_id, storage_key, position, created_at) VALUES ($1,$2,$3,$4,now()-$5::interval) RETURNING id, storage_key`,
        [fresh.id, alice.id, `${fresh.id}/${randomUUID()}.webp`, position, age],
      )
    ).rows[0];
  const abandoned = await reserve(0, '11 minutes');
  const retained = (
    await fixture.migration.query(
      `INSERT INTO public.listing_photos (listing_id,owner_id,storage_key,position,state)
    VALUES ($1,$2,$3,1,'deleting') RETURNING id,storage_key`,
      [cleanListing.id, bob.id, `${cleanListing.id}/${randomUUID()}.webp`],
    )
  ).rows[0];
  const imageBytes = Buffer.from(await (await fetch(photo.url)).arrayBuffer());
  await fixture.storage.upload(abandoned.storage_key, imageBytes);
  await fixture.storage.upload(retained.storage_key, imageBytes);
  const repository = new PhotosRepository(fixture.runtime);
  const photos = new PhotosService(repository, fixture.storage);
  const race = await reserve(1, '11 minutes');
  await fixture.storage.upload(race.storage_key, imageBytes);
  const original = repository.abandoned.bind(repository);
  repository.abandoned = async (id) => {
    const rows = await original(id);
    await repository.activate(race.id, 300, 240, imageBytes.length);
    return rows;
  };
  await photos.cleanup(alice.id, fresh.id);
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT state FROM public.listing_photos WHERE id=$1',
        [race.id],
      )
    ).rows[0].state,
    'active',
  );
  assert.ok((await fetch(fixture.storage.publicUrl(race.storage_key))).ok);
  const recent = await reserve(2, '0 minutes');
  await fixture.storage.upload(recent.storage_key, imageBytes);
  const avatarKey = `avatars/${alice.id}/${randomUUID()}.webp`;
  await fixture.storage.upload(avatarKey, imageBytes);
  await fixture.migration.query(
    'INSERT INTO public.avatar_cleanup (owner_id,storage_key) VALUES ($1,$2)',
    [alice.id, avatarKey],
  );
  const failed = await reserve(0, '11 minutes');
  await fixture.storage.upload(failed.storage_key, imageBytes);
  const failingPhotos = new PhotosService(
    new PhotosRepository(fixture.runtime),
    {
      ...fixture.storage,
      remove: async () => {
        throw new Error('Synthetic Storage failure');
      },
    },
  );
  await assert.rejects(failingPhotos.cleanup(alice.id, fresh.id));
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT state FROM public.listing_photos WHERE id=$1',
        [failed.id],
      )
    ).rows[0].state,
    'deleting',
  );
  const activeAvatar = photo.url.split('/item-media/')[1];
  await fixture.migration.query(
    'UPDATE public.profiles SET avatar_storage_key=$2 WHERE id=$1',
    [alice.id, activeAvatar],
  );
  await fixture.migration.query(
    'INSERT INTO public.avatar_cleanup (owner_id,storage_key) VALUES ($1,$2)',
    [alice.id, activeAvatar],
  );
  execFileSync('pnpm', ['--filter', '@swapcircle/api', 'cleanup:local'], {
    cwd: new URL('../../..', import.meta.url),
    env: { ...process.env, CLEANUP_LOCAL_SYNTHETIC: '1' },
    stdio: 'pipe',
  });
  assert.equal((await fetch(fixture.storage.publicUrl(avatarKey))).ok, false);
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT 1 FROM public.listing_photos WHERE id=$1',
        [abandoned.id],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT 1 FROM public.listing_photos WHERE id=$1',
        [recent.id],
      )
    ).rowCount,
    1,
  );
  assert.ok((await fetch(fixture.storage.publicUrl(retained.storage_key))).ok);
  assert.ok((await fetch(photo.url)).ok);
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT 1 FROM public.listing_photos WHERE id=$1',
        [failed.id],
      )
    ).rowCount,
    0,
  );
  assert.equal((await counts()).messages, before.messages);
  // Production UI uses restored real Auth/PostgreSQL/Storage, with only OAuth handoff simulated.
  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    VITE_API_URL: apiOrigin,
    VITE_SUPABASE_URL: fixture.publicAuth.url,
    VITE_SUPABASE_PUBLISHABLE_KEY: fixture.publicAuth.key,
  };
  execFileSync('pnpm', ['build'], {
    cwd: new URL('..', import.meta.url),
    env: environment,
    stdio: 'pipe',
  });
  preview = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4212',
      '--strictPort',
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: environment,
      stdio: 'ignore',
      detached: true,
    },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* bounded startup */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready);
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.route(
    `${fixture.publicAuth.url}/auth/v1/authorize?*`,
    async (route) => {
      const callback = new URL(
        new URL(route.request().url()).searchParams.get('redirect_to'),
      );
      callback.searchParams.set('code', 'local-synthetic-provider-handoff');
      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
    },
  );
  await page.route(`${fixture.publicAuth.url}/auth/v1/token?*`, (route) =>
    route.fulfill({
      json: { ...alice.session, expires_in: 3600, token_type: 'bearer' },
    }),
  );
  await page.goto(`${origin}/swaps`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(
    page.getByRole('link', { name: 'My Swaps' }).first(),
  ).toBeVisible();
  await page.goto(`${origin}/browse`);
  await expect(
    page.getByText('Restored camera', { exact: true }).first(),
  ).toBeVisible();
  const restoredImage = page.locator(`img[src="${photo.url}"]`).first();
  await expect(restoredImage).toBeVisible();
  assert.ok(
    await restoredImage.evaluate(
      (node) => node.complete && node.naturalWidth > 0,
    ),
  );
  await page.screenshot({
    path: new URL('listing.png', evidence).pathname,
    fullPage: true,
  });
  await page.goto(`${origin}/inbox/${conversation.id}`);
  await expect(
    page.getByRole('region', { name: 'Message history' }),
  ).toContainText('Synthetic message restored from encrypted export.');
  await page.screenshot({
    path: new URL('conversation.png', evidence).pathname,
    fullPage: true,
  });
  await page.goto(`${origin}/swaps/${trade.id}`);
  await expect(
    page.getByRole('region', { name: 'Swap lifecycle' }),
  ).toContainText('cancelled, not completed');
  await page.screenshot({
    path: new URL('history.png', evidence).pathname,
    fullPage: true,
  });
  const require = createRequire(
    new URL('../../api/package.json', import.meta.url),
  );
  const Sentry = require('@sentry/node');
  const envelopes = [];
  initializeMonitoring(
    'https://public@synthetic.invalid/1',
    'synthetic-restore',
    () => ({
      send: async (envelope) => {
        envelopes.push(envelope);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  );
  const originalQuery = fixture.runtime.query.bind(fixture.runtime);
  let fail = true;
  fixture.runtime.query = (...args) => {
    if (fail && String(args[0]).includes('FROM public.listings'))
      throw new Error('synthetic-private-message-marker');
    return originalQuery(...args);
  };
  await page.goto(`${origin}/shelf`);
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  await Sentry.flush(5000);
  assert.ok(envelopes.length);
  assert.ok(
    !JSON.stringify(envelopes).includes('synthetic-private-message-marker'),
  );
  const event = envelopes.at(-1)[1][0][1];
  assert.ok(event.tags.request_id);
  await page.screenshot({
    path: new URL('safe-error.png', evidence).pathname,
    fullPage: true,
  });
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('Restored camera', { exact: true }).first(),
  ).toBeVisible();
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await expect(
    page.getByRole('heading', { name: 'My Shelf', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: new URL('recovered.png', evidence).pathname,
    fullPage: true,
  });
  fixture.runtime.query = originalQuery;
  await Sentry.close(2000);
  // Retained candidates must be excluded before LIMIT, otherwise the same first
  // sixteen listings starve all later orphan handles on every invocation.
  const protectedKeys = [];
  for (let i = 0; i < 17; i++) {
    const id = `00000000-0000-4000-8000-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    await fixture.migration.query(
      `INSERT INTO public.listings (id,owner_id,title,description,condition)
      VALUES ($1,$2,'Synthetic retained image','Synthetic cleanup fairness fixture','good')`,
      [id, alice.id],
    );
    await fixture.migration.query(
      `INSERT INTO public.trade_items
      (trade_id,version_id,listing_id,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot)
      SELECT trade_id,version_id,$1,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot
      FROM public.trade_items WHERE listing_id=$2 LIMIT 1`,
      [id, items[0].id],
    );
    const key = `${id}/${randomUUID()}.webp`;
    await fixture.migration.query(
      `INSERT INTO public.listing_photos (listing_id,owner_id,storage_key,position,state)
      VALUES ($1,$2,$3,0,'deleting')`,
      [id, alice.id, key],
    );
    await fixture.storage.upload(key, imageBytes);
    protectedKeys.push(key);
  }
  for (let i = 0; i < 2; i++) {
    const id = `ffffffff-ffff-4fff-8fff-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const key = `${id}/${randomUUID()}.webp`;
    await fixture.migration.query(
      `INSERT INTO public.listings (id,owner_id,title,description,condition)
      VALUES ($1,$2,'Synthetic orphan image','Synthetic cleanup fairness fixture','good')`,
      [id, alice.id],
    );
    await fixture.migration.query(
      `INSERT INTO public.listing_photos (listing_id,owner_id,storage_key,position,state)
      VALUES ($1,$2,$3,0,'deleting')`,
      [id, alice.id, key],
    );
    await fixture.storage.upload(key, imageBytes);
    execFileSync('pnpm', ['--filter', '@swapcircle/api', 'cleanup:local'], {
      cwd: new URL('../../..', import.meta.url),
      env: { ...process.env, CLEANUP_LOCAL_SYNTHETIC: '1' },
      stdio: 'pipe',
    });
    assert.equal(
      (
        await fixture.migration.query(
          'SELECT 1 FROM public.listing_photos WHERE listing_id=$1',
          [id],
        )
      ).rowCount,
      0,
    );
    assert.equal((await fetch(fixture.storage.publicUrl(key))).ok, false);
  }
  for (const key of protectedKeys)
    assert.ok((await fetch(fixture.storage.publicUrl(key))).ok);
  assert.equal((await counts()).messages, before.messages);
  console.log(
    'Recovery: actual SQL/accounts/messages/history and separate object-byte restore, corruption refusal, atomic cleanup race/history/recent upload protection and bounded fairness, production visual recovery and private local monitoring passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  if (server) await new Promise((done) => server.close(done));
  const remaining = (
    await fixture.migration.query(
      'SELECT id FROM auth.users WHERE id=ANY($1::uuid[])',
      [fixture.users.map((user) => user.id)],
    )
  ).rows;
  fixture.users.splice(
    0,
    fixture.users.length,
    ...fixture.users.filter((user) =>
      remaining.some((row) => row.id === user.id),
    ),
  );
  try {
    await fixture.cleanup();
  } finally {
    await rm(privateDirectory, { recursive: true, force: true });
  }
}
