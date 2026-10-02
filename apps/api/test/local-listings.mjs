// Isolated local integration check using synthetic Supabase users only.
import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { databaseConfig } from '@swapcircle/database';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';
import { ProfilesRepository } from '../dist/features/profiles/profiles.repository.js';
import { ListingsRepository } from '../dist/features/listings/listings.repository.js';
import { ListingsService } from '../dist/features/listings/listings.service.js';
import { listingSchema, listingPageSchema } from '@swapcircle/contracts';
import { ProfilesService } from '../dist/features/profiles/profiles.service.js';

const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);

assert.equal(status.API_URL, 'http://127.0.0.1:55431');
assert.equal(process.env.NODE_ENV, 'development');
for (const value of [
  process.env.DATABASE_URL,
  process.env.MIGRATION_DATABASE_URL,
]) {
  const target = new URL(value);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55432');
  assert.equal(target.pathname, '/postgres');
}

const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
const migration = new Pool(
  databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const app = createApp({
  allowedOrigins: [],
  verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
  listings: new ListingsService(new ListingsRepository(runtime)),
  profiles: new ProfilesService(new ProfilesRepository(runtime)),
});

const ids = [];

async function createSyntheticUser() {
  const email = `profile-check-${randomUUID()}@example.invalid`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  assert.equal(created.error, null);
  ids.push(created.data.user.id);

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
  const [alice, bob] = await Promise.all([
    createSyntheticUser(),
    createSyntheticUser(),
  ]);
  const data = {
    title: 'Synthetic book',
    description: 'Local test only',
    condition: 'good',
  };
  const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
  const create = (user, body = data) =>
    request(app).post('/api/v1/listings').set(auth(user)).send(body);
  const edit = (user, id, body) =>
    request(app).put(`/api/v1/listings/${id}`).set(auth(user)).send(body);
  const withdraw = (user, id, revision) =>
    request(app)
      .post(`/api/v1/listings/${id}/withdraw`)
      .set(auth(user))
      .send({ revision });
  await request(app).post('/api/v1/listings').send(data).expect(401);
  const a = (await create(alice).expect(201)).body;
  const b = (await create(bob).expect(201)).body;
  await request(app).get('/api/v1/listings/mine').expect(401);
  const aliceShelf = await request(app)
    .get('/api/v1/listings/mine')
    .set(auth(alice))
    .expect(200);
  listingPageSchema.parse(aliceShelf.body);
  assert.deepEqual(
    aliceShelf.body.items.map((item) => item.id),
    [a.id],
  );
  assert.ok(!aliceShelf.body.items.some((item) => item.id === b.id));
  const bobShelf = await request(app)
    .get('/api/v1/listings/mine')
    .set(auth(bob))
    .expect(200);
  assert.deepEqual(
    bobShelf.body.items.map((item) => item.id),
    [b.id],
  );
  listingSchema.parse(a);
  const publicItem = (
    await request(app).get(`/api/v1/listings/${a.id}`).expect(200)
  ).body;
  assert.deepEqual(
    Object.keys(publicItem).sort(),
    [
      'id',
      'ownerId',
      'title',
      'description',
      'condition',
      'availability',
      'revision',
      'createdAt',
      'updatedAt',
    ].sort(),
  );
  const publicOwner = (
    await request(app).get(`/api/v1/members/${alice.id}`).expect(200)
  ).body;
  assert.deepEqual(
    Object.keys(publicOwner).sort(),
    [
      'id',
      'displayName',
      'biography',
      'approximateLocation',
      'avatarUrl',
      'interests',
    ].sort(),
  );
  assert.equal(publicOwner.avatarUrl, null);
  assert.equal(a.ownerId, alice.id);
  assert.equal(b.ownerId, bob.id);
  await edit(bob, a.id, { ...data, revision: 1 }).expect(404);
  await edit(alice, b.id, { ...data, revision: 1 }).expect(404);
  await withdraw(bob, a.id, 1).expect(404);
  await request(app)
    .put(`/api/v1/listings/${a.id}`)
    .send({ ...data, revision: 1 })
    .expect(401);
  for (const invalid of [
    { ...data, ownerId: bob.id },
    { ...data, availability: 'reserved' },
    { ...data, title: ' ' },
    { ...data, condition: 'unknown' },
    { ...data, description: 'x'.repeat(5001) },
  ]) {
    await create(alice, invalid).expect(400);
  }
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.listings WHERE owner_id = $1',
        [alice.id],
      )
    ).rowCount,
    1,
  );
  await edit(alice, a.id, { ...data, revision: 1, ownerId: bob.id }).expect(
    400,
  );
  const raced = await Promise.all([
    edit(alice, a.id, { ...data, title: 'First', revision: 1 }),
    edit(alice, a.id, { ...data, title: 'Second', revision: 1 }),
  ]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  await withdraw(alice, a.id, 1).expect(409);
  const changed = await request(app)
    .get(`/api/v1/listings/${a.id}`)
    .expect(200);
  assert.equal(changed.body.revision, 2);
  for (const state of ['reserved', 'exchanged', 'disputed']) {
    // Terminal inventory is never reset for another assertion, even in fixtures.
    const unavailableId = randomUUID();
    await migration.query(
      `INSERT INTO public.listings (id,owner_id,title,description,condition,revision,availability)
       VALUES ($1,$2,'Synthetic unavailable item','Isolated state guard fixture','good',2,$3)`,
      [unavailableId, alice.id, state],
    );
    await edit(alice, unavailableId, { ...data, revision: 2 }).expect(409);
    await withdraw(alice, unavailableId, 2).expect(409);
    assert.equal(
      (await request(app).get(`/api/v1/listings/${unavailableId}`)).body
        .availability,
      state,
    );
    await migration.query('DELETE FROM public.listings WHERE id=$1', [
      unavailableId,
    ]);
  }
  const withdrawn = await withdraw(alice, a.id, 2).expect(200);
  assert.equal(withdrawn.body.revision, 3);
  await request(app).get(`/api/v1/listings/${a.id}`).expect(404);
  const withdrawnShelf = await request(app)
    .get('/api/v1/listings/mine')
    .set(auth(alice))
    .expect(200);
  assert.equal(withdrawnShelf.body.items[0].availability, 'withdrawn');
  assert.equal(withdrawnShelf.body.items[0].revision, 3);
  await withdraw(bob, a.id, 3).expect(404);
  await edit(alice, a.id, { ...data, revision: 3 }).expect(409);
  const tied = [b];
  for (let i = 0; i < 4; i++) tied.push((await create(bob).expect(201)).body);
  let shelfCursor;
  const shelfIds = [];
  do {
    const shelfPage = await request(app)
      .get('/api/v1/listings/mine')
      .set(auth(bob))
      .query({ limit: 2, ...(shelfCursor ? { cursor: shelfCursor } : {}) })
      .expect(200);
    listingPageSchema.parse(shelfPage.body);
    shelfIds.push(...shelfPage.body.items.map((item) => item.id));
    shelfCursor = shelfPage.body.nextCursor;
  } while (shelfCursor);
  assert.deepEqual(new Set(shelfIds), new Set(tied.map((item) => item.id)));
  assert.ok(!shelfIds.includes(a.id));
  await migration.query(
    "UPDATE public.listings SET created_at='2100-01-01T00:00:00.123456Z' WHERE owner_id=$1",
    [bob.id],
  );
  let cursor;
  const seen = [];
  do {
    const page = await request(app)
      .get('/api/v1/listings')
      .query({ limit: 2, ...(cursor ? { cursor } : {}) })
      .expect(200);
    listingPageSchema.parse(page.body);
    seen.push(...page.body.items.map((item) => item.id));
    cursor = page.body.nextCursor;
  } while (cursor);
  assert.deepEqual(
    seen.slice(0, 5),
    tied
      .map((item) => item.id)
      .sort()
      .reverse(),
  );
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(!seen.includes(a.id));
  for (const query of [
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: 'invalid' },
    { ownerId: alice.id },
  ]) {
    await request(app).get('/api/v1/listings').query(query).expect(400);
  }
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id, reason) VALUES ($1, $2)',
    [bob.id, 'synthetic'],
  );
  await create(bob).expect(403);
  await edit(bob, b.id, { ...data, revision: 1 }).expect(403);
  await withdraw(bob, b.id, 1).expect(403);
  for (const client of [
    alice.client,
    bob.client,
    createClient(status.API_URL, status.ANON_KEY, options),
  ]) {
    assert.notEqual((await client.from('listings').select('*')).error, null);
    assert.notEqual(
      (await client.from('listings').insert({ owner_id: alice.id, ...data }))
        .error,
      null,
    );
    assert.notEqual(
      (await client.from('listings').update({ title: 'Bypass' }).eq('id', b.id))
        .error,
      null,
    );
    assert.notEqual(
      (await client.from('listings').delete().eq('id', b.id)).error,
      null,
    );
  }
  console.info(
    'Local listings: real authentication, ownership, validation/atomicity, revision races, state guards, withdrawal visibility, microsecond pagination ties and direct access denial passed.',
  );
} finally {
  for (const id of ids) {
    await migration.query('DELETE FROM public.listings WHERE owner_id=$1', [
      id,
    ]);
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id=$1',
      [id],
    );
    assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
  }
  await runtime.end();
  await migration.end();
}
