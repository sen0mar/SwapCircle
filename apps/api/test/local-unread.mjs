// Real isolated PostgreSQL, verified local tokens and owner-only RLS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import { ConversationsRepository } from '../dist/features/conversations/conversations.repository.js';
import { ConversationsService } from '../dist/features/conversations/conversations.service.js';
import { createApp } from '../dist/app.js';
import { createDiscoveryFixture } from './discovery-fixture.mjs';
const fixture = await createDiscoveryFixture();
const [alice, bob, carol, dan] = fixture.users;
const app = fixture.makeApp({
  allowance: 500,
  windowSeconds: 3600,
  burstMax: 500,
  burstWindowMs: 60000,
});
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const state = (user, id) =>
  request(app).get(`/api/v1/conversations/${id}/unread`).set(auth(user));
const read = (user, conversation_id, message_id) =>
  request(app)
    .put('/api/v1/conversations/read')
    .set(auth(user))
    .send({ conversation_id, message_id });
const start = async (other) =>
  (
    await request(app)
      .post('/api/v1/conversations/direct')
      .set(auth(alice))
      .send({ userId: other.id })
      .expect(200)
  ).body.id;
const send = async (user, id) =>
  (
    await request(app)
      .post('/api/v1/conversations/messages')
      .set(auth(user))
      .send({
        conversation_id: id,
        client_message_id: randomUUID(),
        body: 'Synthetic unread fixture',
      })
      .expect(200)
  ).body;
try {
  for (const user of fixture.users)
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  const direct = await start(bob);
  const other = await start(carol);
  const first = await send(bob, direct);
  await send(alice, direct);
  const third = await send(bob, direct);
  const fourth = await send(bob, direct);
  const unrelated = await send(carol, other);
  assert.deepEqual((await state(alice, direct).expect(200)).body, {
    lastViewedOrder: 0,
    unreadCount: 3,
  });
  await request(app)
    .put('/api/v1/conversations/read')
    .send({ conversation_id: direct, message_id: first.id })
    .expect(401);
  await request(app).get(`/api/v1/conversations/${direct}/unread`).expect(401);
  await request(app)
    .put('/api/v1/conversations/read')
    .set(auth(alice))
    .send({ conversation_id: direct, message_id: first.id, user_id: bob.id })
    .expect(400);
  await read(alice, direct, 'invalid').expect(400);
  await read(carol, direct, first.id).expect(403);
  await state(carol, direct).expect(403);
  await read(alice, direct, unrelated.id).expect(403);
  await read(alice, direct, randomUUID()).expect(403);
  assert.deepEqual((await read(alice, direct, first.id).expect(200)).body, {
    lastViewedOrder: 1,
    unreadCount: 2,
  });
  await Promise.all([
    read(alice, direct, third.id).expect(200),
    read(alice, direct, fourth.id).expect(200),
    read(alice, direct, first.id).expect(200),
  ]);
  assert.deepEqual((await state(alice, direct).expect(200)).body, {
    lastViewedOrder: 4,
    unreadCount: 0,
  });
  assert.deepEqual((await read(alice, direct, first.id).expect(200)).body, {
    lastViewedOrder: 4,
    unreadCount: 0,
  });
  assert.equal((await state(alice, other).expect(200)).body.unreadCount, 1);
  assert.equal((await state(bob, direct).expect(200)).body.unreadCount, 1);
  // Owner-only SELECT and complete direct-write/RPC denial, even to peers.
  const sql = await fixture.migration.connect();
  try {
    await sql.query('BEGIN');
    for (const [user, expected] of [
      [alice, 1],
      [bob, 0],
      [carol, 0],
    ]) {
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        user.id,
      ]);
      await sql.query('SET LOCAL ROLE authenticated');
      assert.equal(
        (await sql.query('SELECT * FROM public.conversation_reads')).rowCount,
        expected,
      );
      await sql.query('RESET ROLE');
    }
    await sql.query('ROLLBACK');
  } finally {
    sql.release();
  }
  for (const user of [alice, bob]) {
    const result = await user.client
      .from('conversation_reads')
      .select('*')
      .retry(false);
    assert.equal(result.error, null);
    assert.equal(result.data.length, user === alice ? 1 : 0);
    for (const operation of [
      user.client.from('conversation_reads').insert({
        conversation_id: direct,
        user_id: user.id,
        last_viewed_order: 4,
      }),
      user.client
        .from('conversation_reads')
        .update({ last_viewed_order: 1 })
        .eq('conversation_id', direct),
      user.client
        .from('conversation_reads')
        .delete()
        .eq('conversation_id', direct),
    ])
      assert.ok((await operation.retry(false)).error);
  }
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
    [direct, alice.id],
  );
  await read(alice, direct, fourth.id).expect(403);
  await state(alice, direct).expect(403);
  assert.equal(
    (await alice.client.from('conversation_reads').select('*').retry(false))
      .data.length,
    0,
  );
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
    [direct, alice.id],
  );
  // Revocation already holding the membership row cannot be acknowledged through
  // a stale authorization snapshot. The read waits, then rejects after commit.
  const revoker = await fixture.migration.connect();
  try {
    await revoker.query('BEGIN');
    await revoker.query(
      'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
      [direct, alice.id],
    );
    let settled = false;
    const pending = read(alice, direct, fourth.id).then((result) => {
      settled = true;
      return result;
    });
    await setTimeout(50);
    assert.equal(settled, false);
    await revoker.query('COMMIT');
    assert.equal((await pending).status, 403);
  } finally {
    await revoker.query('ROLLBACK');
    revoker.release();
  }
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
    [direct, alice.id],
  );
  await fixture.migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [alice.id, 'Synthetic restriction'],
  );
  await read(alice, direct, fourth.id).expect(403);
  await state(alice, direct).expect(403);
  await fixture.migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [alice.id],
  );
  const group = (
    await fixture.migration.query(
      "INSERT INTO public.conversations(type) VALUES ('group') RETURNING id",
    )
  ).rows[0].id;
  await fixture.migration.query(
    'INSERT INTO public.conversation_members(conversation_id,user_id,active) VALUES ($1,$2,true),($1,$3,true),($1,$4,false)',
    [group, alice.id, carol.id, dan.id],
  );
  // A failure after a real upsert must roll back progress; retry remains safe.
  class FailingRepository extends ConversationsRepository {
    async advanceRead(client, actor, id, message) {
      await super.advanceRead(client, actor, id, message);
      throw new Error('Synthetic unread persistence failure');
    }
  }
  const failedApp = createApp({
    allowedOrigins: [],
    verifyToken: async () => carol.id,
    conversations: new ConversationsService(
      new FailingRepository(fixture.runtime),
    ),
  });
  const failure = await request(failedApp)
    .put('/api/v1/conversations/read')
    .set(auth(carol))
    .send({ conversation_id: other, message_id: unrelated.id })
    .expect(500);
  assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(failure.body).includes('Synthetic'));
  assert.equal((await state(carol, other).expect(200)).body.lastViewedOrder, 0);
  await read(carol, other, unrelated.id).expect(200);
  const grouped = await send(carol, group);
  await read(dan, group, grouped.id).expect(403);
  await read(bob, group, grouped.id).expect(403);
  await read(alice, group, grouped.id).expect(200);
  assert.equal((await state(carol, group).expect(200)).body.lastViewedOrder, 0);
  console.info(
    'Local unread: incoming-only counts, exact target validation, forged identity/auth denial, monotonic concurrent/old-session updates, independent conversations/members, persistence, peer/outsider/pending/left/restricted authorization, owner-only SQL/PostgREST reads and all direct writes denied passed.',
  );
} finally {
  await fixture.cleanup();
}
