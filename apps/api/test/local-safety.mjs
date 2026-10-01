import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import console from 'node:console';
import request from 'supertest';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../dist/app.js';
import { createTokenVerifier } from '../dist/auth/verify.js';
import { ProfilesRepository } from '../dist/features/profiles/profiles.repository.js';
import { ProfilesService } from '../dist/features/profiles/profiles.service.js';
import { blockPageSchema, reportReceiptSchema } from '@swapcircle/contracts';
import {
  SafetyPermissions,
  developmentLimits,
} from '../dist/features/safety/safety.permissions.js';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fetch = globalThis.fetch;
const fixture = await createDiscoveryFixture();
const {
  app: application,
  makeApp,
  migration,
  runtime,
  users: [alice, bob, carol, dan],
} = fixture;
// Keep one listener for concurrent HTTP assertions instead of closing an ephemeral
// Supertest server between requests while Node may reuse a keep-alive socket.
const app = application.listen(0, '127.0.0.1');
await once(app, 'listening');
const servers = [app];
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const base = '/api/v1/safety';
const block = (user, other, instance = app) =>
  request(instance)
    .put(`${base}/blocks`)
    .set(auth(user))
    .send({ userId: other.id });
const unblock = (user, other) =>
  request(app).delete(`${base}/blocks/${other.id}`).set(auth(user));
const blocks = async (user) =>
  (await request(app).get(`${base}/blocks`).set(auth(user)).expect(200)).body;
const report = (user, data, instance = app) =>
  request(instance).post(`${base}/reports`).set(auth(user)).send(data);
const listing = {
  title: 'Synthetic safety listing',
  description: 'Only isolated local fixtures',
  condition: 'good',
};
const create = (user, instance = app) =>
  request(instance).post('/api/v1/listings').set(auth(user)).send(listing);
const permissions = new SafetyPermissions();
const checkContact = async (actor, other) => {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await permissions.assertContactAllowed(client, actor.id, other.id);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
};
const quotaUsed = async (user, action) =>
  (
    await migration.query(
      'SELECT used FROM public.action_quotas WHERE user_id=$1 AND action=$2',
      [user.id, action],
    )
  ).rows[0]?.used ?? 0;

try {
  for (const user of [alice, bob, carol])
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  await request(app).get(`${base}/blocks`).expect(401);
  await request(app)
    .get(`${base}/blocks`)
    .set('Authorization', 'Bearer forged')
    .expect(401);
  await request(app).get(`${base}/status`).expect(401);
  const status = async (user, target) =>
    (
      await request(app)
        .get(`${base}/status`)
        .set(auth(user))
        .query(target ? { userId: target.id } : {})
        .expect(200)
    ).body;
  assert.deepEqual(await status(alice, bob), {
    restricted: false,
    ownBlocked: false,
  });
  await checkContact(alice, bob);
  await block(alice, alice).expect(400);
  await block(alice, { id: randomUUID() }).expect(404);
  assert.equal(await quotaUsed(alice, 'block'), 0);
  const duplicates = await Promise.all(
    Array.from({ length: 5 }, () => block(alice, bob)),
  );
  assert.ok(duplicates.every((result) => result.status === 204));
  assert.equal(await quotaUsed(alice, 'block'), 1);
  assert.deepEqual(
    (await blocks(alice)).items.map((row) => row.userId),
    [bob.id],
  );
  blockPageSchema.parse(await blocks(alice));
  assert.equal(typeof (await blocks(alice)).items[0].displayName, 'string');
  assert.deepEqual(await status(alice, bob), {
    restricted: false,
    ownBlocked: true,
  });
  assert.deepEqual(await status(bob, alice), {
    restricted: false,
    ownBlocked: false,
  });
  assert.deepEqual((await blocks(bob)).items, []);
  await assert.rejects(checkContact(alice, bob), { code: 'CONTACT_BLOCKED' });
  await assert.rejects(checkContact(bob, alice), { code: 'CONTACT_BLOCKED' });
  await unblock(bob, alice).expect(204);
  await assert.rejects(checkContact(bob, alice), { code: 'CONTACT_BLOCKED' });
  await block(alice, carol).expect(204);
  const first = (
    await request(app)
      .get(`${base}/blocks`)
      .set(auth(alice))
      .query({ limit: 1 })
      .expect(200)
  ).body;
  const second = (
    await request(app)
      .get(`${base}/blocks`)
      .set(auth(alice))
      .query({ limit: 1, after: first.nextAfter })
      .expect(200)
  ).body;
  assert.deepEqual(
    new Set([...first.items, ...second.items].map((row) => row.userId)),
    new Set([bob.id, carol.id]),
  );
  assert.equal(second.nextAfter, null);
  await unblock(alice, bob).expect(204);
  await unblock(alice, bob).expect(204);
  assert.equal(await quotaUsed(alice, 'block'), 3);
  await checkContact(alice, bob);
  // A contact check waits for a concurrent block transaction and sees its commit.
  const blocker = await runtime.connect();
  try {
    await blocker.query('BEGIN');
    await permissions.lockPair(blocker, alice.id, bob.id);
    await blocker.query(
      'INSERT INTO public.blocks (blocker_id, blocked_id) VALUES ($1,$2)',
      [alice.id, bob.id],
    );
    let settled = false;
    const waiting = checkContact(bob, alice).then(
      () => {
        settled = true;
        return null;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false);
    await blocker.query('COMMIT');
    assert.equal((await waiting).code, 'CONTACT_BLOCKED');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await unblock(alice, bob).expect(204);

  const item = (await create(bob).expect(201)).body;
  const input = {
    clientReportId: randomUUID(),
    targetType: 'member',
    targetId: bob.id,
    reason: '<script>Private synthetic report</script>',
  };
  const retries = await Promise.all(
    Array.from({ length: 5 }, () => report(alice, input)),
  );
  assert.ok(retries.every((result) => result.status === 201));
  for (const result of retries) {
    reportReceiptSchema.parse(result.body);
    assert.deepEqual(result.body, retries[0].body);
    assert.deepEqual(Object.keys(result.body).sort(), ['createdAt', 'id']);
  }
  assert.equal(await quotaUsed(alice, 'report'), 1);
  await report(alice, { ...input, reason: 'Changed reason' }).expect(409);
  await report(alice, { ...input, targetId: carol.id }).expect(409);
  await report(alice, { ...input, reporterId: bob.id }).expect(400);
  await report(alice, {
    ...input,
    clientReportId: randomUUID(),
    targetId: randomUUID(),
  }).expect(404);
  await report(bob, input).expect(201); // Keys are scoped to verified reporter identity.
  await report(alice, {
    ...input,
    clientReportId: randomUUID(),
    targetType: 'listing',
    targetId: item.id,
  }).expect(201);
  for (const user of [alice, bob, carol]) {
    await request(app)
      .get(`${base}/reports/${retries[0].body.id}`)
      .set(auth(user))
      .expect(404);
    await request(app).get(`${base}/reports`).set(auth(user)).expect(404);
  }
  const publicProfile = (
    await request(app).get(`/api/v1/members/${bob.id}`).expect(200)
  ).body;
  assert.deepEqual(
    Object.keys(publicProfile).sort(),
    [
      'id',
      'displayName',
      'biography',
      'approximateLocation',
      'avatarUrl',
      'interests',
    ].sort(),
  );
  assert.ok(
    !JSON.stringify((await request(app).get('/api/v1/members')).body).includes(
      input.reason,
    ),
  );
  // Grants AND RLS defend the tables, even if a SELECT grant is accidentally added.
  const client = await migration.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'GRANT SELECT ON public.blocks, public.reports, public.action_quotas, public.account_restrictions TO authenticated',
    );
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      alice.id,
    ]);
    for (const table of [
      'blocks',
      'reports',
      'action_quotas',
      'account_restrictions',
    ])
      assert.equal(
        (await client.query(`SELECT * FROM public.${table}`)).rowCount,
        0,
      );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const anonymous = createClient(
    fixture.publicAuth.url,
    fixture.publicAuth.key,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  for (const user of [alice, bob, carol, { client: anonymous }]) {
    for (const table of [
      'blocks',
      'reports',
      'action_quotas',
      'account_restrictions',
    ]) {
      assert.notEqual((await user.client.from(table).select('*')).error, null);
      assert.notEqual(
        (
          await user.client
            .from(table)
            .delete()
            .neq(
              table === 'blocks'
                ? 'blocker_id'
                : table === 'reports'
                  ? 'reporter_id'
                  : 'user_id',
              randomUUID(),
            )
        ).error,
        null,
      );
    }
    for (const [table, data] of [
      ['blocks', { blocker_id: alice.id, blocked_id: bob.id }],
      [
        'reports',
        {
          reporter_id: alice.id,
          client_report_id: randomUUID(),
          reported_user_id: bob.id,
          reason: 'bypass',
        },
      ],
      ['action_quotas', { user_id: alice.id, action: 'report', used: 1 }],
    ]) {
      assert.notEqual((await user.client.from(table).insert(data)).error, null);
      assert.notEqual((await user.client.from(table).update(data)).error, null);
    }
  }
  await assert.rejects(
    runtime.query('UPDATE public.reports SET reason=$1 WHERE id=$2', [
      'bypass',
      retries[0].body.id,
    ]),
    { code: '42501' },
  );
  for (const [sql, values, code] of [
    [
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$1)',
      [alice.id],
      '23514',
    ],
    [
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
      [alice.id, carol.id],
      '23505',
    ],
    [
      'INSERT INTO public.reports (reporter_id,client_report_id,reason) VALUES ($1,$2,$3)',
      [alice.id, randomUUID(), 'targetless'],
      '23514',
    ],
    [
      'INSERT INTO public.reports (reporter_id,client_report_id,reported_user_id,listing_id,reason) VALUES ($1,$2,$3,$4,$5)',
      [alice.id, randomUUID(), bob.id, item.id, 'two targets'],
      '23514',
    ],
    [
      'INSERT INTO public.action_quotas (user_id,action,used) VALUES ($1,$2,0)',
      [alice.id, 'listing'],
      '23514',
    ],
    [
      'INSERT INTO public.action_quotas (user_id,action,used) VALUES ($1,$2,1)',
      [alice.id, 'unknown'],
      '23514',
    ],
  ])
    await assert.rejects(migration.query(sql, values), { code });

  const limited = makeApp({ ...developmentLimits, allowance: 2 }).listen(
    0,
    '127.0.0.1',
  );
  servers.push(limited);
  await once(limited, 'listening');
  // Dan has never fetched a profile: report submission must provision quota ownership.
  const allowanceRace = await Promise.all(
    Array.from({ length: 7 }, () =>
      report(dan, { ...input, clientReportId: randomUUID() }, limited),
    ),
  );
  assert.deepEqual(
    allowanceRace.map((result) => result.status).sort(),
    [201, 201, 429, 429, 429, 429, 429],
  );
  assert.equal(await quotaUsed(dan, 'report'), 2);
  const allowanceRow = await migration.query(
    'SELECT client_report_id FROM public.reports WHERE reporter_id=$1 LIMIT 1',
    [dan.id],
  );
  await report(
    dan,
    { ...input, clientReportId: allowanceRow.rows[0].client_report_id },
    limited,
  ).expect(201);
  const blockRace = await Promise.all(
    [alice, bob, carol].map((other) => block(dan, other, limited)),
  );
  assert.deepEqual(
    blockRace.map((result) => result.status).sort(),
    [204, 204, 429],
  );
  assert.equal(await quotaUsed(dan, 'block'), 2);
  const racedListings = await Promise.all(
    Array.from({ length: 6 }, () => create(carol, limited)),
  );
  assert.deepEqual(
    racedListings.map((result) => result.status).sort(),
    [201, 201, 429, 429, 429, 429],
  );
  assert.equal(await quotaUsed(carol, 'listing'), 2);
  assert.equal(
    (
      await migration.query(
        'SELECT id FROM public.listings WHERE owner_id=$1',
        [carol.id],
      )
    ).rowCount,
    2,
  );
  // Restart two real Express processes: persisted allowances and own blocks survive.
  for (let i = 0; i < 2; i++) {
    const worker = fork(new URL('./safety-worker.mjs', import.meta.url), [], {
      execArgv: [],
      env: {
        ...process.env,
        LOCAL_AUTH_URL: fixture.publicAuth.url,
        LOCAL_AUTH_KEY: fixture.publicAuth.key,
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    try {
      const [{ port }] = await once(worker, 'message');
      const result = await fetch(`http://127.0.0.1:${port}/api/v1/listings`, {
        method: 'POST',
        headers: { ...auth(carol), 'Content-Type': 'application/json' },
        body: JSON.stringify(listing),
      });
      assert.equal(result.status, 429);
      assert.equal((await result.json()).error.code, 'ACTION_LIMIT');
      const own = await fetch(`http://127.0.0.1:${port}${base}/blocks`, {
        headers: auth(alice),
      });
      assert.equal(own.status, 200);
      assert.deepEqual(
        (await own.json()).items.map((row) => row.userId),
        [carol.id],
      );
    } finally {
      const exited = once(worker, 'exit');
      worker.kill('SIGTERM');
      await exited;
    }
  }
  await migration.query(
    "UPDATE public.action_quotas SET window_started_at=now()-interval '2 hours' WHERE user_id=$1 AND action='listing'",
    [carol.id],
  );
  await create(carol, limited).expect(201);
  assert.equal(await quotaUsed(carol, 'listing'), 1);
  // Failed writes roll back quota usage; profile and avatar writes have independent limits.
  const before = await quotaUsed(bob, 'listing');
  await request(app)
    .put(`/api/v1/listings/${item.id}`)
    .set(auth(bob))
    .send({ ...listing, revision: 999 })
    .expect(409);
  assert.equal(await quotaUsed(bob, 'listing'), before);
  const profileData = {
    displayName: 'Synthetic member',
    biography: '',
    approximateLocation: '',
    interestIds: [],
  };
  for (let i = 0; i < 2; i++)
    await request(limited)
      .put('/api/v1/profiles/me')
      .set(auth(dan))
      .send(profileData)
      .expect(200);
  await request(limited)
    .put('/api/v1/profiles/me')
    .set(auth(dan))
    .send(profileData)
    .expect(429);
  const failedProfileQuota = await quotaUsed(dan, 'profile');
  await request(app)
    .put('/api/v1/profiles/me')
    .set(auth(dan))
    .send({ ...profileData, interestIds: [randomUUID()] })
    .expect(400);
  assert.equal(await quotaUsed(dan, 'profile'), failedProfileQuota);
  const image = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#cccccc' },
  })
    .png()
    .toBuffer();
  for (let i = 0; i < 2; i++)
    await request(limited)
      .post(`/api/v1/listings/${item.id}/photos`)
      .set(auth(bob))
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(201);
  await request(limited)
    .post(`/api/v1/listings/${item.id}/photos`)
    .set(auth(bob))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(429);
  assert.equal(await quotaUsed(bob, 'photo'), 2);
  for (let i = 0; i < 2; i++)
    await request(limited)
      .post('/api/v1/profiles/me/avatar')
      .set(auth(dan))
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(201);
  await request(limited)
    .post('/api/v1/profiles/me/avatar')
    .set(auth(dan))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(429);
  await request(limited)
    .post('/api/v1/profiles/me/avatar')
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(Buffer.from('invalid'))
    .expect(415);
  assert.equal(await quotaUsed(alice, 'avatar'), 1);
  const failedStorage = createApp({
    allowedOrigins: [],
    verifyToken: createTokenVerifier(
      fixture.publicAuth.url,
      fixture.publicAuth.key,
    ),
    profiles: new ProfilesService(
      new ProfilesRepository(
        runtime,
        new SafetyPermissions({ ...developmentLimits, allowance: 2 }),
      ),
      {
        upload: async () => {
          throw new Error('Synthetic storage failure');
        },
        remove: async () => {},
        publicUrl: (key) => fixture.storage.publicUrl(key),
      },
    ),
  });
  await request(failedStorage)
    .post('/api/v1/profiles/me/avatar')
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(503);
  assert.equal(await quotaUsed(alice, 'avatar'), 2);
  await request(limited)
    .post('/api/v1/profiles/me/avatar')
    .set(auth(alice))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(429);
  assert.equal(
    (await request(app).get('/api/v1/profiles/me').set(auth(alice))).body
      .avatarUrl,
    null,
  );
  // Restrictions are checked on existing writes and on both sides of future contact.
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id, reason) VALUES ($1,$2)',
    [bob.id, 'Private synthetic restriction'],
  );
  await assert.rejects(checkContact(alice, bob), {
    code: 'ACCOUNT_RESTRICTED',
  });
  await assert.rejects(checkContact(bob, alice), {
    code: 'ACCOUNT_RESTRICTED',
  });
  await create(bob).expect(403);
  await request(app)
    .put('/api/v1/profiles/me')
    .set(auth(bob))
    .send(profileData)
    .expect(403);
  await request(app)
    .post('/api/v1/profiles/me/avatar')
    .set(auth(bob))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(403);
  await request(app)
    .delete('/api/v1/profiles/me/avatar')
    .set(auth(bob))
    .expect(403);
  await request(app)
    .post('/api/v1/profiles/me/avatar/cleanup')
    .set(auth(bob))
    .expect(403);
  await request(app)
    .post(`/api/v1/listings/${item.id}/photos`)
    .set(auth(bob))
    .set('Content-Type', 'image/png')
    .send(image)
    .expect(403);
  await request(app)
    .post(`/api/v1/listings/${item.id}/photos/cleanup`)
    .set(auth(bob))
    .expect(403);
  await block(bob, alice).expect(204);
  await report(bob, {
    ...input,
    clientReportId: randomUUID(),
    targetId: alice.id,
  }).expect(201);
  await unblock(bob, alice).expect(204);
  assert.deepEqual(await status(bob), { restricted: true, ownBlocked: false });
  const restrictedPublic = (
    await request(app).get(`/api/v1/members/${bob.id}`).expect(200)
  ).body;
  assert.deepEqual(
    Object.keys(restrictedPublic).sort(),
    Object.keys(publicProfile).sort(),
  );
  console.info(
    'Local safety: own blocks, both directions/current restrictions, racing contact, private retry-safe reports, grants/RLS/bypasses/constraints, concurrent atomic allowances, rollback, window expiry, two actual Express restarts and existing write limits passed.',
  );
} finally {
  // Remove test avatar objects before fixture account cleanup.
  for (const user of [alice, bob, carol, dan]) {
    const avatars = await migration.query(
      'SELECT avatar_storage_key AS key FROM public.profiles WHERE id=$1 UNION SELECT storage_key AS key FROM public.avatar_cleanup WHERE owner_id=$1',
      [user.id],
    );
    for (const row of avatars.rows)
      if (row.key) await fixture.storage.remove(row.key);
  }
  for (const server of servers)
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await fixture.cleanup();
}
