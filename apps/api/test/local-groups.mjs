// Guarded isolated local resources and synthetic accounts only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import console from 'node:console';
import request from 'supertest';
import { groupMembershipReceiptSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  app,
  migration,
  runtime,
  users: [alice, bob, carol, outsider],
} = fixture;
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const items = new Map();
const respond = (user, id, action) =>
  request(app).put(`/api/v1/conversations/${id}/${action}`).set(auth(user));
const send = (user, id, body = 'Synthetic group message') =>
  request(app)
    .post('/api/v1/conversations/messages')
    .set(auth(user))
    .send({ conversation_id: id, body, client_message_id: randomUUID() });
const read = async (user, table, column, id) => {
  const result = await user.client.from(table).select('*').eq(column, id);
  assert.equal(result.error, null);
  return result.data;
};
const create = async (members, operationKey = randomUUID()) => {
  const response = await request(app)
    .post('/api/v1/trades')
    .set(auth(alice))
    .send({
      operationKey,
      participantIds: members.map((user) => user.id),
      transfers: members.map((user, index) => ({
        listingId: items.get(user.id),
        ownerId: user.id,
        recipientId: members[(index + 1) % members.length].id,
      })),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      meetingMode: 'meet_to_swap',
    });
  return response;
};
const groupFor = async (trade) =>
  (
    await migration.query(
      'SELECT id FROM public.conversations WHERE trade_id=$1',
      [trade],
    )
  ).rows[0]?.id;
const membership = async (user, group) =>
  (
    await migration.query(
      'SELECT * FROM public.conversation_members WHERE conversation_id=$1 AND user_id=$2',
      [group, user.id],
    )
  ).rows[0];
const events = async (group) =>
  (
    await migration.query(
      'SELECT * FROM public.conversation_membership_events WHERE conversation_id=$1 ORDER BY created_at,id',
      [group],
    )
  ).rows;
const notifications = async (group) =>
  (
    await migration.query(
      'SELECT * FROM public.notifications WHERE resource_id=$1',
      [group],
    )
  ).rows;
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await setTimeout(50);
  }
  assert.fail('Expected authorized Realtime event did not arrive');
};
const streams = [];
try {
  for (const user of fixture.users) {
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
    const id = randomUUID();
    items.set(user.id, id);
    await migration.query(
      "INSERT INTO public.listings (id,owner_id,title,description,condition) VALUES ($1,$2,'Synthetic group item','Isolated membership fixture','good')",
      [id, user.id],
    );
  }
  const direct = (
    await request(app)
      .post('/api/v1/conversations/direct')
      .set(auth(alice))
      .send({ userId: bob.id })
      .expect(200)
  ).body.id;
  const privateMessage = (
    await send(alice, direct, 'Synthetic private DM').expect(200)
  ).body.id;
  const two = await create([alice, bob]);
  assert.equal(two.status, 201);
  assert.equal(await groupFor(two.body.id), undefined);
  // Fail after the group and memberships exist: the entire proposal and its
  // trade/group notifications must disappear, while unrelated DMs survive.
  await migration.query(
    `CREATE FUNCTION public.synthetic_group_invitation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='group_invitation' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await migration.query(
    'CREATE TRIGGER synthetic_group_invitation_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_group_invitation_failure()',
  );
  const failedKey = randomUUID();
  assert.equal((await create([alice, bob, carol], failedKey)).status, 500);
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.trades WHERE creator_id=$1 AND operation_key=$2',
        [alice.id, failedKey],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.conversations c JOIN public.trades t ON t.id=c.trade_id WHERE t.creator_id=$1',
        [alice.id],
      )
    ).rowCount,
    0,
  );
  assert.equal((await read(bob, 'messages', 'id', privateMessage)).length, 1);
  await migration.query(
    'DROP TRIGGER synthetic_group_invitation_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION public.synthetic_group_invitation_failure()',
  );
  const key = randomUUID();
  const proposals = await Promise.all([
    create([alice, bob, carol], key),
    create([alice, bob, carol], key),
  ]);
  assert.ok(proposals.every((result) => result.status === 201));
  assert.deepEqual(proposals[0].body, proposals[1].body);
  const trade = proposals[0].body.id;
  const group = await groupFor(trade);
  assert.ok(group && group !== direct);
  assert.equal((await events(group)).length, 1);
  assert.equal((await notifications(group)).length, 2);
  assert.deepEqual(
    new Set((await notifications(group)).map((row) => row.recipient_id)),
    new Set([bob.id, carol.id]),
  );
  assert.equal((await membership(alice, group)).status, 'accepted');
  const initialTerms = (
    await request(app).get(`/api/v1/trades/${trade}`).set(auth(bob)).expect(200)
  ).body;

  // Real channels are ready before commits. A forged conversation filter never
  // bypasses membership, and the same socket loses subsequent events on leave.
  for (const user of fixture.users) {
    await user.client.realtime.setAuth(user.token);
    const received = [];
    const channel = user.client
      .channel(`group-${randomUUID()}`, {
        config: { postgres_changes_options: { wait: true } },
      })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${group}`,
        },
        (event) => received.push(event.new.id),
      );
    await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(new Error('Group subscription timeout')),
        25000,
      );
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          globalThis.clearTimeout(timer);
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          globalThis.clearTimeout(timer);
          reject(new Error('Group subscription failed'));
        }
      });
    });
    streams.push({ user, channel, received });
  }
  const first = (await send(alice, group).expect(200)).body;
  await waitFor(() => streams[0].received.includes(first.id));
  for (const user of [bob, carol, outsider]) {
    assert.deepEqual(
      await read(user, 'messages', 'conversation_id', group),
      [],
    );
    assert.deepEqual(await read(user, 'conversations', 'id', group), []);
    await send(user, group).expect(403);
    await request(app)
      .get(`/api/v1/conversations/${group}/unread`)
      .set(auth(user))
      .expect(403);
    assert.deepEqual(
      streams.find((stream) => stream.user === user).received,
      [],
    );
  }
  assert.equal(
    (await read(bob, 'conversation_members', 'conversation_id', group)).length,
    1,
  );
  await respond(outsider, group, 'invitation/accept').expect(403);
  await respond(bob, direct, 'invitation/accept').expect(403);
  await respond(bob, group, 'leave').expect(409);
  await request(app)
    .put(`/api/v1/conversations/${group}/invitation/accept`)
    .set(auth(bob))
    .send({ actorId: alice.id })
    .expect(400);

  const joined = await Promise.all([
    respond(bob, group, 'invitation/accept'),
    respond(bob, group, 'invitation/accept'),
  ]);
  assert.ok(joined.every((result) => result.status === 200));
  assert.deepEqual(joined[0].body, joined[1].body);
  assert.equal(groupMembershipReceiptSchema.parse(joined[0].body).active, true);
  assert.equal(
    (await events(group)).filter((row) => row.event_type === 'accepted').length,
    1,
  );
  assert.equal(
    (await notifications(group)).filter(
      (row) => row.event_type === 'group_membership',
    ).length,
    2,
  );
  const saved = await membership(bob, group);
  await respond(bob, group, 'invitation/accept').expect(200);
  assert.deepEqual(await membership(bob, group), saved);
  const history = await read(bob, 'messages', 'conversation_id', group);
  assert.deepEqual(
    history.map((row) => row.id),
    [first.id],
  );
  assert.ok(!history.some((row) => row.id === privateMessage));
  const live = (await send(bob, group).expect(200)).body;
  await waitFor(
    () =>
      streams[0].received.includes(live.id) &&
      streams[1].received.includes(live.id),
  );
  assert.deepEqual(streams[2].received, []);
  assert.deepEqual(streams[3].received, []);
  const joinedTerms = (
    await request(app).get(`/api/v1/trades/${trade}`).set(auth(bob)).expect(200)
  ).body;
  assert.deepEqual(joinedTerms, initialTerms);

  // Existing membership survives blocks; new joint proposals still fail.
  await request(app)
    .put('/api/v1/safety/blocks')
    .set(auth(bob))
    .send({ userId: alice.id })
    .expect(204);
  await send(bob, group).expect(200);
  await send(bob, direct).expect(403);
  assert.equal((await create([alice, bob, carol])).status, 403);
  await request(app)
    .delete(`/api/v1/safety/blocks/${alice.id}`)
    .set(auth(bob))
    .expect(204);
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [carol.id, 'Synthetic restriction'],
  );
  await respond(carol, group, 'invitation/accept').expect(403);
  assert.equal((await membership(carol, group)).status, 'pending');
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [carol.id],
  );

  // A notification failure rolls back membership and event together.
  await migration.query(
    `CREATE FUNCTION public.synthetic_membership_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='group_membership' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
  );
  await migration.query(
    'CREATE TRIGGER synthetic_membership_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_membership_failure()',
  );
  const beforeEvents = await events(group);
  const beforeNotifications = await notifications(group);
  await respond(carol, group, 'invitation/decline').expect(500);
  await respond(bob, group, 'leave').expect(500);
  assert.deepEqual(await membership(bob, group), saved);
  assert.equal((await read(bob, 'messages', 'id', live.id)).length, 1);
  assert.equal((await membership(carol, group)).status, 'pending');
  assert.deepEqual(await events(group), beforeEvents);
  assert.deepEqual(await notifications(group), beforeNotifications);
  await migration.query(
    'DROP TRIGGER synthetic_membership_failure ON public.notifications',
  );
  await migration.query('DROP FUNCTION public.synthetic_membership_failure()');
  await respond(carol, group, 'invitation/decline').expect(200);
  await respond(carol, group, 'invitation/decline').expect(200);
  await respond(carol, group, 'invitation/accept').expect(409);
  await send(carol, group).expect(403);

  await respond(bob, group, 'leave').expect(200);
  const left = await membership(bob, group);
  await respond(bob, group, 'leave').expect(200);
  assert.deepEqual(await membership(bob, group), left);
  await respond(bob, group, 'invitation/accept').expect(409);
  await send(bob, group).expect(403);
  await request(app)
    .get(`/api/v1/conversations/${group}/unread`)
    .set(auth(bob))
    .expect(403);
  for (const table of ['messages', 'conversations', 'conversation_reads'])
    assert.deepEqual(
      await read(
        bob,
        table,
        table === 'conversations' ? 'id' : 'conversation_id',
        group,
      ),
      [],
    );
  const afterLeave = (await send(alice, group).expect(200)).body;
  await waitFor(() => streams[0].received.includes(afterLeave.id));
  await setTimeout(500);
  assert.ok(!streams[1].received.includes(afterLeave.id));
  assert.deepEqual(streams[2].received, []);
  assert.deepEqual(streams[3].received, []);
  assert.equal((await read(bob, 'messages', 'id', privateMessage)).length, 1);
  assert.deepEqual(
    (
      await request(app)
        .get(`/api/v1/trades/${trade}`)
        .set(auth(bob))
        .expect(200)
    ).body,
    initialTerms,
  );

  // Four participants remain rows, with no three-person limit. Concurrent
  // opposing responses serialize to one terminal state, never two consents.
  const four = await create(fixture.users);
  assert.equal(four.status, 201);
  const otherGroup = await groupFor(four.body.id);
  const race = await Promise.all([
    respond(outsider, otherGroup, 'invitation/accept'),
    respond(outsider, otherGroup, 'invitation/decline'),
  ]);
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  assert.equal(
    (await events(otherGroup)).filter((row) => row.actor_id === outsider.id)
      .length,
    1,
  );
  await respond(bob, otherGroup, 'invitation/accept').expect(200);
  const holder = await runtime.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `safety:${bob.id}`,
    ]);
    await holder.query('SELECT private.respond_group_membership($1,$2,$3)', [
      otherGroup,
      bob.id,
      'left',
    ]);
    let settled = false;
    const waiting = send(bob, otherGroup).then((result) => {
      settled = true;
      return result;
    });
    await setTimeout(50);
    assert.equal(settled, false);
    await holder.query('COMMIT');
    assert.equal((await waiting).status, 403);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }

  for (const user of fixture.users) {
    assert.ok(
      (
        await user.client
          .from('conversation_members')
          .update({ active: true, status: 'accepted' })
          .eq('conversation_id', group)
      ).error,
    );
    assert.ok(
      (
        await user.client
          .from('conversation_members')
          .insert({ conversation_id: group, user_id: user.id })
      ).error,
    );
    assert.ok(
      (
        await user.client
          .from('conversation_members')
          .delete()
          .eq('conversation_id', group)
      ).error,
    );
    assert.ok(
      (await user.client.from('conversation_membership_events').select('*'))
        .error,
    );
    assert.ok(
      (
        await user.client.rpc('respond_group_membership', {
          target: group,
          actor: alice.id,
          response: 'accepted',
        })
      ).error,
    );
    assert.ok(
      (
        await user.client.schema('private').rpc('respond_group_membership', {
          target: group,
          actor: alice.id,
          response: 'accepted',
        })
      ).error,
    );
  }
  await assert.rejects(
    runtime.query(
      'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1',
      [group],
    ),
    { code: '42501' },
  );
  await assert.rejects(
    runtime.query(
      "UPDATE public.conversation_membership_events SET event_type='accepted' WHERE conversation_id=$1",
      [group],
    ),
    { code: '42501' },
  );
  await assert.rejects(
    migration.query('UPDATE public.conversations SET trade_id=$1 WHERE id=$2', [
      four.body.id,
      group,
    ]),
    { code: '23514' },
  );
  console.info(
    'Local group membership passed: separate retry-safe trade-linked groups, DM isolation, pending/outsider denial, independent consent, four participants, terminal responses, notification rollback, block/restriction policy, leave/send serialization, direct-write/RPC denial and actual Realtime delivery/revocation.',
  );
} finally {
  await migration.query(
    'DROP TRIGGER IF EXISTS synthetic_group_invitation_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION IF EXISTS public.synthetic_group_invitation_failure()',
  );
  await migration.query(
    'DROP TRIGGER IF EXISTS synthetic_membership_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION IF EXISTS public.synthetic_membership_failure()',
  );
  for (const user of fixture.users) {
    await user.client.removeAllChannels();
    await user.client.realtime.disconnect();
  }
  await fixture.cleanup();
}
