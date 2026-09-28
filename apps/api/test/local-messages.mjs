// Real PostgreSQL and verified local sessions; only guarded synthetic fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import console from 'node:console';
import request from 'supertest';
import { messageReceiptSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';
import { developmentLimits } from '../dist/features/safety/safety.permissions.js';
import { ConversationsRepository } from '../dist/features/conversations/conversations.repository.js';
import { ConversationsService } from '../dist/features/conversations/conversations.service.js';
import { SafetyPermissions } from '../dist/features/safety/safety.permissions.js';
import { createApp } from '../dist/app.js';

const fixture = await createDiscoveryFixture();
const {
  runtime,
  migration,
  users: [alice, bob, carol, dan],
} = fixture;
const app = fixture.makeApp({ ...developmentLimits, burstMax: 500 });
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const send = (user, input, instance = app) =>
  request(instance)
    .post('/api/v1/conversations/messages')
    .set(auth(user))
    .send(input);
const input = (id, body = 'Synthetic plain text', key = randomUUID()) => ({
  conversation_id: id,
  body,
  client_message_id: key,
});
const start = async (user, other) =>
  (
    await request(app)
      .post('/api/v1/conversations/direct')
      .set(auth(user))
      .send({ userId: other.id })
      .expect(200)
  ).body.id;
const snapshot = async (id) =>
  (
    await migration.query(
      `SELECT last_message_order,(SELECT count(*)::int FROM public.messages WHERE conversation_id=$1) AS count
   FROM public.conversations WHERE id=$1`,
      [id],
    )
  ).rows[0];
const quota = async (user) =>
  (
    await migration.query(
      "SELECT used FROM public.action_quotas WHERE user_id=$1 AND action='message'",
      [user.id],
    )
  ).rows[0]?.used ?? 0;
const clearQuota = (user) =>
  migration.query(
    "DELETE FROM public.action_quotas WHERE user_id=$1 AND action='message'",
    [user.id],
  );

try {
  for (const user of [alice, bob, carol, dan])
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  const direct = await start(alice, bob);
  const other = await start(alice, carol);
  const originalInput = input(
    direct,
    '  <script>plain text & preserved whitespace</script>  ',
  );
  await request(app)
    .post('/api/v1/conversations/messages')
    .send(originalInput)
    .expect(401);
  await request(app)
    .post('/api/v1/conversations/messages')
    .set('Authorization', 'Bearer forged')
    .send(originalInput)
    .expect(401);
  for (const invalid of [
    { ...originalInput, sender_id: bob.id },
    { ...originalInput, body: '' },
    { ...originalInput, body: ' \n\t' },
    { ...originalInput, body: 'x'.repeat(5001) },
    { ...originalInput, client_message_id: 'invalid' },
    { ...originalInput, conversation_id: 'invalid' },
    {},
  ])
    await send(alice, invalid).expect(400);
  await send(carol, originalInput).expect(403);
  await send(alice, input(randomUUID())).expect(403);
  assert.deepEqual(await snapshot(direct), { last_message_order: 0, count: 0 });

  const first = messageReceiptSchema.parse(
    (await send(alice, originalInput).expect(200)).body,
  );
  assert.equal(first.sender_id, alice.id);
  assert.equal(first.body, originalInput.body);
  const repeats = await Promise.all(
    Array.from({ length: 6 }, () => send(alice, originalInput)),
  );
  for (const result of repeats) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, first);
  }
  assert.equal(await quota(alice), 7);
  const upper = {
    ...originalInput,
    conversation_id: direct.toUpperCase(),
    client_message_id: originalInput.client_message_id.toUpperCase(),
  };
  assert.deepEqual((await send(alice, upper).expect(200)).body, first);
  for (const changed of [
    { ...originalInput, body: 'changed' },
    { ...originalInput, conversation_id: other },
  ]) {
    const conflict = await send(alice, changed).expect(409);
    assert.equal(conflict.body.error.code, 'MESSAGE_RETRY_CONFLICT');
  }
  const freshRetry = input(direct, 'x'.repeat(5000));
  const freshRaces = await Promise.all(
    Array.from({ length: 6 }, () => send(alice, freshRetry)),
  );
  for (const result of freshRaces) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, freshRaces[0].body);
  }
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
        [alice.id, freshRetry.client_message_id],
      )
    ).rowCount,
    1,
  );
  const raceKey = randomUUID();
  const races = await Promise.all([
    send(alice, input(direct, 'race A', raceKey)),
    send(alice, input(other, 'race B', raceKey)),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  const sameKey = randomUUID();
  const contentRace = await Promise.all([
    send(alice, input(direct, 'A', sameKey)),
    send(alice, input(direct, 'B', sameKey)),
  ]);
  assert.deepEqual(contentRace.map((r) => r.status).sort(), [200, 409]);
  const before = await snapshot(direct);
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      send(i % 2 ? bob : alice, input(direct)),
    ),
  );
  assert.ok(concurrent.every((r) => r.status === 200));
  const orders = concurrent
    .map((r) => r.body.message_order)
    .sort((a, b) => a - b);
  assert.deepEqual(
    orders,
    Array.from({ length: 10 }, (_, i) => before.last_message_order + i + 1),
  );
  // The same key belongs to the sender, not the conversation or another sender.
  await send(bob, originalInput).expect(200);

  const stable = await snapshot(direct);
  const expectDeniedRetry = async (user = alice) => {
    await send(user, originalInput).expect(403);
    await send(user, input(direct)).expect(403);
    assert.deepEqual(await snapshot(direct), stable);
  };
  for (const member of [alice, bob]) {
    await migration.query(
      'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
      [direct, member.id],
    );
    await expectDeniedRetry();
    await migration.query(
      'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
      [direct, member.id],
    );
    await migration.query(
      'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
      [member.id, 'Synthetic restriction'],
    );
    await expectDeniedRetry();
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id=$1',
      [member.id],
    );
    const blocked = member === alice ? bob : alice;
    await request(app)
      .put('/api/v1/safety/blocks')
      .set(auth(member))
      .send({ userId: blocked.id })
      .expect(204);
    await expectDeniedRetry();
    await request(app)
      .delete(`/api/v1/safety/blocks/${blocked.id}`)
      .set(auth(member))
      .expect(204);
  }

  // An uncommitted block owns the same ordered account locks as send/retry.
  const blocker = await runtime.connect();
  try {
    await blocker.query('BEGIN');
    for (const id of [alice.id, bob.id].sort())
      await blocker.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`safety:${id}`],
      );
    await blocker.query(
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
      [bob.id, alice.id],
    );
    let settled = false;
    const pending = send(alice, originalInput).then((r) => {
      settled = true;
      return r;
    });
    await setTimeout(40);
    assert.equal(settled, false);
    await blocker.query('COMMIT');
    assert.equal((await pending).status, 403);
    assert.deepEqual(await snapshot(direct), stable);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await request(app)
    .delete(`/api/v1/safety/blocks/${alice.id}`)
    .set(auth(bob))
    .expect(204);

  const group = (
    await migration.query(
      "INSERT INTO public.conversations (type) VALUES ('group') RETURNING id",
    )
  ).rows[0].id;
  await migration.query(
    'INSERT INTO public.conversation_members (conversation_id,user_id,active) VALUES ($1,$2,true),($1,$3,true),($1,$4,false)',
    [group, alice.id, carol.id, dan.id],
  );
  await request(app)
    .put('/api/v1/safety/blocks')
    .set(auth(alice))
    .send({ userId: carol.id })
    .expect(204);
  await send(alice, input(group)).expect(200);
  await send(carol, input(group)).expect(200);
  await send(dan, input(group)).expect(403);
  await send(bob, input(group)).expect(403);
  assert.equal((await snapshot(group)).count, 2);

  await clearQuota(alice);
  const limited = fixture.makeApp({ ...developmentLimits, allowance: 1 });
  const limitedInput = input(direct);
  await send(alice, limitedInput, limited).expect(200);
  const limitedSnapshot = await snapshot(direct);
  for (const attempt of [limitedInput, input(direct)]) {
    const result = await send(alice, attempt, limited).expect(429);
    assert.equal(result.body.error.code, 'ACTION_LIMIT');
    assert.ok(result.headers['retry-after']);
  }
  assert.deepEqual(await snapshot(direct), limitedSnapshot);
  assert.equal(await quota(alice), 1);
  await migration.query(
    "UPDATE public.action_quotas SET window_started_at=statement_timestamp()-interval '2 hours' WHERE user_id=$1 AND action='message'",
    [alice.id],
  );
  await send(alice, limitedInput, limited).expect(200);
  assert.equal(await quota(alice), 1);
  await clearQuota(bob);
  const quotaRaces = await Promise.all([
    send(bob, input(direct), limited),
    send(bob, input(direct), limited),
  ]);
  assert.deepEqual(quotaRaces.map((r) => r.status).sort(), [200, 429]);
  assert.equal(await quota(bob), 1);
  const burst = fixture.makeApp({ ...developmentLimits, burstMax: 1 });
  await send(bob, originalInput, burst).expect(200);
  assert.equal(
    (await send(bob, originalInput, burst).expect(429)).body.error.code,
    'BURST_LIMIT',
  );

  // Inject a failure after real INSERT/trigger execution: message, order and quota
  // must all roll back, and retry must safely produce the first durable result.
  class FailingRepository extends ConversationsRepository {
    async insertMessage(client, actor, value) {
      await super.insertMessage(client, actor, value);
      throw new Error('Synthetic persistence failure');
    }
  }
  await clearQuota(alice);
  const failedApp = createApp({
    allowedOrigins: [],
    verifyToken: async () => alice.id,
    conversations: new ConversationsService(
      new FailingRepository(runtime),
      new SafetyPermissions(),
    ),
  });
  const failedInput = input(direct);
  const prior = await snapshot(direct);
  const failure = await send(alice, failedInput, failedApp).expect(500);
  assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(failure.body).includes('Synthetic'));
  assert.deepEqual(await snapshot(direct), prior);
  assert.equal(await quota(alice), 0);
  const recovered = (await send(alice, failedInput).expect(200)).body;
  assert.equal(recovered.message_order, prior.last_message_order + 1);
  assert.equal(await quota(alice), 1);
  console.info(
    'Local messages: strict validation/auth, exact concurrent retries, cross-conversation/content conflicts, sender-wide deduplication, two-actor stable ordering, current memberships/restrictions/bidirectional blocks and racing block, active group isolation, persistent/retry/burst quotas, expiry and atomic failure rollback/recovery passed.',
  );
} finally {
  await fixture.cleanup();
}
