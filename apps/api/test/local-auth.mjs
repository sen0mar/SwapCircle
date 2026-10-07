// Explicit integration check against the isolated local stack only; never a login route.
import { URL } from 'node:url';
import console from 'node:console';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import request from 'supertest';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';

const status = JSON.parse(
  execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
    cwd: new URL('../../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);

assert.equal(status.API_URL, 'http://127.0.0.1:55431');

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);

const app = createApp({
  allowedOrigins: [],
  verifyToken: createTokenVerifier(status.API_URL, status.ANON_KEY),
});

const ids = [];

try {
  const registrationEmail = `unconfirmed-signup-${randomUUID()}@example.invalid`;
  const registrationPassword = `Local-${randomUUID()}!`;
  const signupClient = createClient(status.API_URL, status.ANON_KEY, options);
  const signup = await signupClient.auth.signUp({
    email: registrationEmail,
    password: registrationPassword,
  });

  if (signup.data.user) ids.push(signup.data.user.id);

  assert.equal(
    signup.error,
    null,
    'Local registration must remain available for OAuth compatibility',
  );
  assert.ok(
    signup.data.user,
    'Local registration did not create a confirmation-pending user',
  );
  assert.equal(
    signup.data.session,
    null,
    'Email registration must not issue an unconfirmed session',
  );

  const unconfirmed = await signupClient.auth.signInWithPassword({
    email: registrationEmail,
    password: registrationPassword,
  });

  assert.equal(
    unconfirmed.error?.code,
    'email_not_confirmed',
    'Unconfirmed email accounts must not sign in',
  );
  assert.equal(unconfirmed.data.session, null);

  for (let index = 0; index < 2; index++) {
    const email = `auth-check-${randomUUID()}@example.invalid`;

    const password = `Local-check-${randomUUID()}!`;

    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    });

    assert.equal(created.error, null, 'Synthetic user creation failed');
    ids.push(created.data.user.id);

    const client = createClient(status.API_URL, status.ANON_KEY, options);

    const rejected = await client.auth.signInWithPassword({
      email,
      password: `wrong-${randomUUID()}`,
    });

    assert.ok(rejected.error, 'Invalid password must be rejected');
    assert.equal(rejected.data.session, null);

    const login = await client.auth.signInWithPassword({ email, password });

    assert.equal(login.error, null, 'Synthetic SDK session failed');

    const response = await request(app)
      .get('/api/v1/identity')
      .set('Authorization', `Bearer ${login.data.session.access_token}`)
      .expect(200);

    assert.deepEqual(response.body, { userId: created.data.user.id });

    await request(app)
      .get('/api/v1/identity')
      .set(
        'Authorization',
        `Bearer ${login.data.session.access_token.slice(0, -15)}invalidsignature`,
      )
      .expect(401);

    assert.equal((await client.auth.signOut({ scope: 'local' })).error, null);
    assert.equal((await client.auth.getSession()).data.session, null);
  }

  await request(app).get('/api/v1/identity').expect(401);

  console.info(
    'Real local Supabase: two synthetic identities, SDK sessions/sign-out, valid token acceptance and invalid/missing token rejection passed.',
  );
} finally {
  for (const id of ids)
    assert.equal(
      (await admin.auth.admin.deleteUser(id)).error,
      null,
      'Synthetic user cleanup failed',
    );
}
