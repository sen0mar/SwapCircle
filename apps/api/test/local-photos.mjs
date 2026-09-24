import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { Pool } from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { databaseConfig } from '@swapcircle/database';
import { listingPhotosSchema } from '@swapcircle/contracts';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';
import { ListingsRepository } from '../dist/features/listings/listings.repository.js';
import { ListingsService } from '../dist/features/listings/listings.service.js';
import { PhotosRepository } from '../dist/features/photos/photos.repository.js';
import { PhotosService } from '../dist/features/photos/photos.service.js';
import { createPhotoStorage } from '../dist/features/photos/photos.storage.js';

const fetch = globalThis.fetch;

const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
assert.equal(status.API_URL, 'http://127.0.0.1:55431');
assert.equal(new URL(process.env.DATABASE_URL).hostname, '127.0.0.1');
const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
const migration = new Pool(
  databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const storage = createPhotoStorage(status.API_URL, status.SERVICE_ROLE_KEY);
const repository = new PhotosRepository(runtime);
const verifier = createTokenVerifier(status.API_URL, status.ANON_KEY);
const app = createApp({
  allowedOrigins: [],
  verifyToken: verifier,
  listings: new ListingsService(new ListingsRepository(runtime)),
  photos: new PhotosService(repository, storage),
});
const users = [];
const listingIds = [];

async function user() {
  const email = `photo-check-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  users.push(created.data.user.id);
  const link = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  assert.equal(link.error, null);
  const client = createClient(status.API_URL, status.ANON_KEY, options);
  const login = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.data.properties.hashed_token,
  });
  assert.equal(login.error, null);
  return {
    id: created.data.user.id,
    token: login.data.session.access_token,
    client,
  };
}

try {
  const [alice, bob] = await Promise.all([user(), user()]);
  const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
  const created = await request(app)
    .post('/api/v1/listings')
    .set(auth(alice))
    .send({
      title: 'Photo item',
      description: 'Synthetic local check',
      condition: 'good',
    })
    .expect(201);
  const listingId = created.body.id;
  listingIds.push(listingId);
  const path = `/api/v1/listings/${listingId}/photos`;
  const png = await sharp({
    create: { width: 300, height: 240, channels: 3, background: '#bb8844' },
  })
    .png()
    .withMetadata({ orientation: 1 })
    .toBuffer();
  await request(app)
    .post(path)
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(401);
  await request(app)
    .post(path)
    .set(auth(bob))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(404);
  await request(app)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(Buffer.alloc(5 * 1024 * 1024 + 1))
    .expect(413);
  await request(app)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(Buffer.from('not a photo'))
    .expect(415);
  const tooManyPixels = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: '#bb8844' },
  })
    .png()
    .toBuffer();
  await request(app)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(tooManyPixels)
    .expect(415);
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.listing_photos WHERE listing_id=$1',
        [listingId],
      )
    ).rowCount,
    0,
  );

  for (let i = 0; i < 2; i++)
    await request(app)
      .post(path)
      .set(auth(alice))
      .set('Content-Type', 'image/png')
      .send(png)
      .expect(201);
  const raced = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(app)
        .post(path)
        .set(auth(alice))
        .set('Content-Type', 'image/png')
        .send(png),
    ),
  );
  assert.deepEqual(raced.map((result) => result.status).sort(), [201, 409]);
  const photos = (await request(app).get(path).expect(200)).body;
  listingPhotosSchema.parse(photos);
  assert.equal(photos.length, 3);
  assert.deepEqual(
    photos.map((photo) => photo.position),
    [0, 1, 2],
  );
  const ordering = await migration.connect();
  try {
    await ordering.query('BEGIN');
    await ordering.query(
      'SET CONSTRAINTS listing_photos_position_unique DEFERRED',
    );
    await ordering.query(
      `UPDATE public.listing_photos SET position = CASE id
       WHEN $1::uuid THEN 1 WHEN $2::uuid THEN 0 ELSE position END
       WHERE id IN ($1::uuid, $2::uuid)`,
      [photos[0].id, photos[1].id],
    );
    await ordering.query('COMMIT');
  } catch (error) {
    await ordering.query('ROLLBACK');
    throw error;
  } finally {
    ordering.release();
  }
  assert.equal(
    (await request(app).get(path).expect(200)).body[0].id,
    photos[1].id,
  );
  for (const photo of photos) {
    assert.equal(new URL(photo.url).origin, status.API_URL);
    const visible = await fetch(photo.url);
    assert.equal(visible.status, 200);
    const bytes = Buffer.from(await visible.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined);
    assert.equal(meta.width, 300);
  }
  assert.notEqual(
    (
      await bob.client.storage
        .from('item-media')
        .upload(`${listingId}/browser.webp`, png, { contentType: 'image/webp' })
    ).error,
    null,
  );
  await alice.client.storage
    .from('item-media')
    .remove([new URL(photos[0].url).pathname.split('/').slice(-2).join('/')]);
  assert.equal((await fetch(photos[0].url)).status, 200);
  await request(app)
    .delete(`${path}/${photos[0].id}`)
    .set(auth(bob))
    .expect(404);
  await request(app)
    .delete(`${path}/${photos[0].id}`)
    .set(auth(alice))
    .expect(204);
  assert.equal((await fetch(photos[0].url)).ok, false);
  assert.equal((await request(app).get(path)).body.length, 2);

  const storedCount = async () =>
    Number(
      (
        await migration.query(
          "SELECT count(*) AS count FROM storage.objects WHERE bucket_id='item-media' AND name LIKE $1",
          [`${listingId}/%`],
        )
      ).rows[0].count,
    );
  assert.equal(await storedCount(), 2);

  const failingStorage = {
    ...storage,
    upload: async () => {
      throw new Error('synthetic storage failure');
    },
  };
  const failedApp = createApp({
    allowedOrigins: [],
    verifyToken: verifier,
    photos: new PhotosService(repository, failingStorage),
  });
  await request(failedApp)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(503);
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.listing_photos WHERE listing_id=$1',
        [listingId],
      )
    ).rowCount,
    2,
  );
  assert.equal(await storedCount(), 2);

  const uncertainStorage = {
    ...storage,
    upload: async (key, body) => {
      await storage.upload(key, body);
      throw new Error('synthetic uncertain storage response');
    },
  };
  const uncertainApp = createApp({
    allowedOrigins: [],
    verifyToken: verifier,
    photos: new PhotosService(repository, uncertainStorage),
  });
  await request(uncertainApp)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(503);
  assert.equal(await storedCount(), 2);
  const abandoned = await migration.query(
    `INSERT INTO public.listing_photos (listing_id, owner_id, storage_key, position, created_at)
     VALUES ($1,$2,$3,1,now() - interval '11 minutes') RETURNING id`,
    [listingId, alice.id, `${listingId}/${randomUUID()}.webp`],
  );
  await request(app).post(`${path}/cleanup`).set(auth(bob)).expect(404);
  await request(app).post(`${path}/cleanup`).set(auth(alice)).expect(204);
  assert.equal(
    (
      await migration.query('SELECT 1 FROM public.listing_photos WHERE id=$1', [
        abandoned.rows[0].id,
      ])
    ).rowCount,
    0,
  );

  const activateFailure = new PhotosRepository(runtime);
  activateFailure.activate = async () => {
    throw new Error('synthetic database failure');
  };
  const cleanupApp = createApp({
    allowedOrigins: [],
    verifyToken: verifier,
    photos: new PhotosService(activateFailure, storage),
  });
  await request(cleanupApp)
    .post(path)
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(png)
    .expect(503);
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.listing_photos WHERE listing_id=$1',
        [listingId],
      )
    ).rowCount,
    2,
  );
  console.info(
    'Local photos: auth, limits, malformed input, concurrent fourth, public processed URL, browser write denial, removal, storage and DB failure cleanup passed.',
  );
} finally {
  for (const listingId of listingIds) {
    const rows = await migration.query(
      'SELECT storage_key FROM public.listing_photos WHERE listing_id=$1',
      [listingId],
    );
    for (const row of rows.rows) await storage.remove(row.storage_key);
    await migration.query(
      'DELETE FROM public.listing_photos WHERE listing_id=$1',
      [listingId],
    );
    await migration.query('DELETE FROM public.listings WHERE id=$1', [
      listingId,
    ]);
  }
  for (const id of users)
    assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
  await runtime.end();
  await migration.end();
}
