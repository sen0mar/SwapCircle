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

const runtime = new Pool(databaseConfig(process.env.DATABASE_URL));
const migration = new Pool(
  databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const app = createApp({
  allowedOrigins: [],
  verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
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
  const authorization = (token) => ({ Authorization: `Bearer ${token}` });

  await Promise.all(
    Array.from({ length: 8 }, () =>
      request(app)
        .get('/api/v1/profiles/me')
        .set(authorization(alice.token))
        .expect(200),
    ),
  );

  assert.equal(
    (
      await migration.query('SELECT id FROM public.profiles WHERE id = $1', [
        alice.id,
      ])
    ).rowCount,
    1,
  );

  const catalogue = await request(app).get('/api/v1/interests').expect(200);

  assert.ok(catalogue.body.length >= 2);

  const interestIds = catalogue.body.slice(0, 2).map(({ id }) => id);
  const update = {
    displayName: 'Alice',
    biography: 'Hello',
    approximateLocation: 'Paris area',
    interestIds,
  };

  await request(app)
    .put('/api/v1/profiles/me')
    .set(authorization(alice.token))
    .send(update)
    .expect(200);

  const persisted = await request(app)
    .get('/api/v1/profiles/me')
    .set(authorization(alice.token))
    .expect(200);

  assert.equal(persisted.body.displayName, 'Alice');
  assert.equal(persisted.body.interests.length, 2);

  for (const invalidIds of [[interestIds[0], interestIds[0]], [randomUUID()]]) {
    const denied = await request(app)
      .put('/api/v1/profiles/me')
      .set(authorization(alice.token))
      .send({ ...update, interestIds: invalidIds })
      .expect(400);

    assert.match(denied.body.error.code, /INVALID_PROFILE|UNKNOWN_INTEREST/);
  }

  const afterInvalid = await request(app)
    .get('/api/v1/profiles/me')
    .set(authorization(alice.token))
    .expect(200);

  assert.deepEqual(afterInvalid.body.interests, persisted.body.interests);

  await request(app)
    .put('/api/v1/profiles/me')
    .set(authorization(bob.token))
    .send({ ...update, displayName: 'Bob', id: alice.id })
    .expect(400);

  const bobUpdate = await request(app)
    .put('/api/v1/profiles/me')
    .set(authorization(bob.token))
    .send({ ...update, displayName: 'Bob' })
    .expect(200);

  assert.equal(bobUpdate.body.id, bob.id);
  assert.equal(
    (
      await request(app)
        .get('/api/v1/profiles/me')
        .set(authorization(alice.token))
    ).body.displayName,
    'Alice',
  );

  await migration.query(
    'INSERT INTO public.account_restrictions (user_id, reason) VALUES ($1, $2)',
    [alice.id, 'private synthetic reason'],
  );

  const publicProfile = await request(app)
    .get(`/api/v1/members/${alice.id}`)
    .expect(200);

  assert.deepEqual(Object.keys(publicProfile.body).sort(), [
    'approximateLocation',
    'avatarUrl',
    'biography',
    'displayName',
    'id',
    'interests',
  ]);
  assert.equal(publicProfile.body.avatarUrl, null);
  assert.ok(
    !JSON.stringify(publicProfile.body).includes('private synthetic reason'),
  );

  await request(app)
    .put('/api/v1/profiles/me')
    .set(authorization(alice.token))
    .send(update)
    .expect(403);
  await request(app).put('/api/v1/profiles/me').send(update).expect(401);
  await request(app).get('/api/v1/members/not-a-uuid').expect(404);

  for (const client of [alice.client, bob.client]) {
    assert.notEqual((await client.from('profiles').select('*')).error, null);
    assert.notEqual(
      (
        await client
          .from('profiles')
          .update({ display_name: 'Bypass' })
          .eq('id', alice.id)
      ).error,
      null,
    );
    assert.notEqual(
      (await client.from('account_restrictions').select('*')).error,
      null,
    );
    assert.notEqual(
      (await client.from('profile_interests').select('*')).error,
      null,
    );
  }

  const anonymous = createClient(status.API_URL, status.ANON_KEY, options);

  assert.notEqual((await anonymous.from('profiles').select('*')).error, null);
  assert.notEqual((await anonymous.from('interests').select('*')).error, null);

  console.info(
    'Local profiles: provisioning, persistence, ownership, validation, restrictions, public exposure and Data API denial passed.',
  );
} finally {
  for (const id of ids) {
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id = $1',
      [id],
    );
    assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
  }

  await runtime.end();
  await migration.end();
}
