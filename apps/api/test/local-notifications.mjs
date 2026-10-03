// Synthetic records on the guarded local stack only. No manufacturing API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import {
  notificationReadSchema,
  notificationsReadReceiptSchema,
} from '@swapcircle/contracts';
import {
  createNotification,
  NotificationsRepository,
} from '../dist/features/notifications/notifications.repository.js';
import { NotificationsService } from '../dist/features/notifications/notifications.service.js';
import { createApp } from '../dist/app.js';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const [alice, bob, carol] = fixture.users;
const app = fixture.makeApp({
  allowance: 500,
  windowSeconds: 3600,
  burstMax: 500,
  burstWindowMs: 60000,
});
const repository = new NotificationsRepository(fixture.runtime);
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const read = (user, id) =>
  request(app)
    .put('/api/v1/notifications/read')
    .set(auth(user))
    .send({ notification_id: id });
const readAll = (user, ids) =>
  request(app)
    .put('/api/v1/notifications/read-all')
    .set(auth(user))
    .send({ notification_ids: ids });
const input = (
  user,
  event_type = 'trade_invitation',
  resource_type = 'trade',
) => ({
  recipient_id: user.id,
  domain_event_id: randomUUID(),
  event_type,
  resource_type,
  resource_id: randomUUID(),
});
const seed = (value) =>
  repository.transaction((client) => createNotification(client, value));
const row = async (id) =>
  (
    await fixture.runtime.query(
      'SELECT * FROM public.notifications WHERE id=$1',
      [id],
    )
  ).rows[0];
const own = async (user) => {
  const result = await user.client
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .retry(false);
  assert.equal(result.error, null);

  return result.data.map((value) => notificationReadSchema.parse(value));
};

try {
  for (const user of fixture.users)
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  const initial = input(alice);
  const first = await seed(initial);
  const peer = await seed(input(bob));
  const second = await seed(input(alice, 'trade_revision'));
  const untouched = await seed(input(alice, 'trade_status'));
  for (const [type, resource] of [
    ['group_invitation', 'conversation'],
    ['coffee_invitation', 'coffee_invitation'],
    ['coffee_response', 'coffee_invitation'],
    ['meeting_change', 'meetup'],
  ])
    await seed(input(bob, type, resource));
  assert.equal((await own(alice)).length, 3);
  assert.equal((await own(bob)).length, 5);
  assert.equal((await own(carol)).length, 0);
  const before = await row(first);
  assert.equal(await seed(initial), first);
  assert.deepEqual(await row(first), before);
  assert.notEqual(await seed({ ...initial, recipient_id: bob.id }), first);

  // A failure after both a domain state change and notification insertion rolls both back.
  const rollback = input(alice);
  await assert.rejects(
    repository.transaction(async (client) => {
      await client.query(
        "UPDATE public.profiles SET display_name='Synthetic rollback' WHERE id=$1",
        [alice.id],
      );
      await createNotification(client, rollback);
      throw new Error('Synthetic transaction failure');
    }),
  );
  assert.equal(
    (
      await fixture.runtime.query(
        'SELECT id FROM public.notifications WHERE domain_event_id=$1',
        [rollback.domain_event_id],
      )
    ).rowCount,
    0,
  );
  assert.notEqual(
    (
      await fixture.runtime.query(
        'SELECT display_name FROM public.profiles WHERE id=$1',
        [alice.id],
      )
    ).rows[0].display_name,
    'Synthetic rollback',
  );
  const retry = await seed(rollback);
  assert.equal(await seed(rollback), retry);

  // Conflicting payload for a retry key fails rather than mutating an earlier event.
  await assert.rejects(
    repository.transaction(async (client) => {
      await client.query(
        "UPDATE public.profiles SET display_name='Synthetic conflict' WHERE id=$1",
        [alice.id],
      );
      await createNotification(client, {
        ...initial,
        resource_id: randomUUID(),
      });
    }),
  );
  assert.deepEqual(await row(first), before);
  assert.notEqual(
    (
      await fixture.runtime.query(
        'SELECT display_name FROM public.profiles WHERE id=$1',
        [alice.id],
      )
    ).rows[0].display_name,
    'Synthetic conflict',
  );

  // Concurrent replay waits on the unique index and converges on one durable ID.
  const concurrent = input(alice);
  const ids = await Promise.all(
    Array.from({ length: 8 }, () => seed(concurrent)),
  );
  assert.equal(new Set(ids).size, 1);
  const creator = await fixture.runtime.connect();
  try {
    await creator.query('BEGIN');
    const pendingInput = input(alice);
    const winner = await createNotification(creator, pendingInput);
    let settled = false;
    const pending = seed(pendingInput).then((id) => {
      settled = true;
      return id;
    });
    await setTimeout(50);
    assert.equal(settled, false);
    await creator.query('COMMIT');
    assert.equal(await pending, winner);
  } finally {
    await creator.query('ROLLBACK');
    creator.release();
  }

  // A rolled-back competing insert must let the waiting retry become the creator.
  const aborter = await fixture.runtime.connect();
  try {
    await aborter.query('BEGIN');
    const abandoned = input(alice);
    const abandonedId = await createNotification(aborter, abandoned);
    const replacement = seed(abandoned);
    await setTimeout(50);
    await aborter.query('ROLLBACK');
    assert.notEqual(await replacement, abandonedId);
    assert.equal(await row(abandonedId), undefined);
  } finally {
    await aborter.query('ROLLBACK');
    aborter.release();
  }

  // The publication delivers real owner INSERT/UPDATE events, but a peer's forged
  // recipient filter cannot reveal the recipient's record or acknowledgment.
  await alice.client.realtime.setAuth(alice.token);
  await bob.client.realtime.setAuth(bob.token);
  const ownerEvents = [];
  const peerEvents = [];
  // A channel join alone does not guarantee the cold replication slot is ready.
  const channels = [
    alice.client
      .channel(`notification-owner-${randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${alice.id}`,
        },
        (event) => ownerEvents.push(event),
      ),
    bob.client
      .channel(`notification-peer-${randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${alice.id}`,
        },
        (event) => peerEvents.push(event),
      ),
  ];
  try {
    await Promise.all(
      channels.map(
        (channel) =>
          new Promise((resolve, reject) => {
            const timer = globalThis.setTimeout(
              () => reject(new Error('Notification subscription timeout')),
              25000,
            );
            channel.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                globalThis.clearTimeout(timer);
                resolve();
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                globalThis.clearTimeout(timer);
                reject(new Error('Notification subscription failed'));
              }
            });
          }),
      ),
    );
    const live = await seed(input(alice));
    await read(alice, live).expect(200);
    for (
      let attempt = 0;
      attempt < 200 &&
      ownerEvents.filter((event) => event.new.id === live).length < 2;
      attempt++
    )
      await setTimeout(50);
    assert.deepEqual(
      ownerEvents
        .filter((event) => event.new.id === live)
        .map((event) => event.eventType),
      ['INSERT', 'UPDATE'],
    );
    await setTimeout(500);
    assert.deepEqual(peerEvents, []);
  } finally {
    await Promise.all([
      alice.client.removeChannel(channels[0]),
      bob.client.removeChannel(channels[1]),
    ]);
  }

  // SQL RLS has the same ownership boundary as PostgREST, including forged filters.
  const sql = await fixture.migration.connect();
  try {
    await sql.query('BEGIN');
    for (const user of [alice, bob, carol]) {
      await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        user.id,
      ]);
      await sql.query('SET LOCAL ROLE authenticated');
      const result = await sql.query('SELECT * FROM public.notifications');
      assert.equal(result.rowCount, (await own(user)).length);
      assert.ok(result.rows.every((value) => value.recipient_id === user.id));
      await sql.query('RESET ROLE');
    }
    await sql.query('ROLLBACK');
  } finally {
    sql.release();
  }
  for (const user of [alice, bob, carol]) {
    const foreign = await user.client
      .from('notifications')
      .select('*')
      .eq('recipient_id', user === alice ? bob.id : alice.id)
      .retry(false);
    assert.equal(foreign.error, null);
    assert.deepEqual(foreign.data, []);
    for (const mutation of [
      user.client.from('notifications').insert(input(user)),
      user.client
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', first),
      user.client.from('notifications').delete().eq('id', first),
      user.client.from('notifications').upsert({ id: first, ...initial }),
    ])
      assert.ok((await mutation.retry(false)).error);
    assert.ok(
      (await user.client.rpc('can_read_notifications').retry(false)).error,
    );
  }
  for (const role of ['anon', 'service_role']) {
    const sql = await fixture.migration.connect();
    try {
      await sql.query('BEGIN');
      await sql.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(sql.query('SELECT * FROM public.notifications'), {
        code: '42501',
      });
    } finally {
      await sql.query('ROLLBACK');
      sql.release();
    }
  }
  await assert.rejects(
    fixture.runtime.query(
      'UPDATE public.notifications SET recipient_id=$1 WHERE id=$2',
      [bob.id, first],
    ),
    { code: '42501' },
  );
  await assert.rejects(
    fixture.runtime.query('DELETE FROM public.notifications WHERE id=$1', [
      first,
    ]),
    { code: '42501' },
  );

  // A valid token cannot acknowledge on behalf of a forged recipient/actor.
  for (const identity of [{ recipient_id: alice.id }, { actorId: alice.id }]) {
    await request(app)
      .put('/api/v1/notifications/read-all')
      .set(auth(bob))
      .send({ notification_ids: [first, peer], ...identity })
      .expect(400);
    assert.equal((await row(first)).read_at, null);
    assert.equal((await row(peer)).read_at, null);
  }

  await read(bob, first).expect(403);
  await read(alice, randomUUID()).expect(403);
  await readAll(alice, [second, peer]).expect(403);
  await readAll(alice, [second, randomUUID()]).expect(403);
  assert.equal((await row(second)).read_at, null);
  assert.equal((await row(peer)).read_at, null);
  const receipt = notificationsReadReceiptSchema.parse(
    (await read(alice, first).expect(200)).body,
  );
  assert.equal(receipt.items[0].id, first);
  const readAt = (await row(first)).read_at;
  await Promise.all([
    read(alice, first).expect(200),
    readAll(alice, [first, second]).expect(200),
    readAll(alice, [second, first]).expect(200),
  ]);
  assert.deepEqual((await row(first)).read_at, readAt);
  assert.ok((await row(second)).read_at);
  assert.equal((await row(untouched)).read_at, null);
  assert.equal(await seed(initial), first);
  assert.deepEqual((await row(first)).read_at, readAt);

  // A notification created before the action but committed afterward remains unread.
  const late = await fixture.runtime.connect();
  try {
    await late.query('BEGIN');
    const lateId = await createNotification(late, input(alice));
    await readAll(alice, [untouched, retry]).expect(200);
    await late.query('COMMIT');
    assert.equal((await row(lateId)).read_at, null);
    const arrived = await seed(input(alice));
    await readAll(alice, [untouched, retry]).expect(200);
    assert.equal((await row(lateId)).read_at, null);
    assert.equal((await row(arrived)).read_at, null);
    // Inject a post-update failure: the whole acknowledgment must roll back.
    class FailingRepository extends NotificationsRepository {
      async markRead(client, actor, ids) {
        await super.markRead(client, actor, ids);
        throw new Error('Synthetic acknowledgment failure');
      }
    }
    const failed = createApp({
      allowedOrigins: [],
      verifyToken: async () => alice.id,
      notifications: new NotificationsService(
        new FailingRepository(fixture.runtime),
      ),
    });
    const failure = await request(failed)
      .put('/api/v1/notifications/read-all')
      .set(auth(alice))
      .send({ notification_ids: [lateId, arrived] })
      .expect(500);
    assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
    assert.ok(!JSON.stringify(failure.body).includes('Synthetic'));
    assert.equal((await row(lateId)).read_at, null);
    assert.equal((await row(arrived)).read_at, null);
    await readAll(alice, [lateId, arrived]).expect(200);
  } finally {
    await late.query('ROLLBACK');
    late.release();
  }

  await fixture.migration.query(
    'INSERT INTO public.account_restrictions(user_id,reason) VALUES ($1,$2)',
    [alice.id, 'Synthetic restriction'],
  );
  await read(alice, first).expect(403);
  await readAll(alice, [first, second]).expect(403);
  assert.deepEqual(await own(alice), []);
  await fixture.migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [alice.id],
  );
  assert.ok((await own(alice)).find((value) => value.id === first)?.read_at);
  assert.equal(
    (
      await fixture.runtime.query(
        'SELECT * FROM public.conversation_reads WHERE user_id=ANY($1::uuid[])',
        [fixture.users.map((user) => user.id)],
      )
    ).rowCount,
    0,
  );
  console.info(
    'Local notifications passed: all seven types; recipient-only SQL/PostgREST reads; anon/service-role/client write/RPC denial; immutable retry and per-recipient dedup; concurrent unique-index commit/rollback waits; recipient-only real Realtime INSERT/UPDATE delivery; shared domain rollback/retry/conflict; forged actor/recipient rejection, ownership-checked atomic mixed-set rejection; monotonic read retries; concurrent single/all reads; late-commit/new-arrival exclusion; post-update rollback and safe errors; restrictions; persistence and separate message read state.',
  );
} finally {
  for (const user of fixture.users) {
    await user.client.removeAllChannels();
    await user.client.realtime.disconnect();
  }
  await fixture.cleanup();
}
