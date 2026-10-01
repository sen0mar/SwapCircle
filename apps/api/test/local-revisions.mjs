// Real isolated local PostgreSQL and verified synthetic Auth tokens only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import request from 'supertest';
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
const terms = (members = [alice, bob], expectedVersion = 1) => ({
  expectedVersion,
  participantIds: members.map((user) => user.id),
  transfers: members.map((user, index) => ({
    listingId: items.get(user.id),
    ownerId: user.id,
    recipientId: members[(index + 1) % members.length].id,
  })),
  meetingMode: 'meet_to_swap',
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
});
const create = async (members = [alice, bob]) => {
  const body = terms(members);
  delete body.expectedVersion;
  return (
    await request(app)
      .post('/api/v1/trades')
      .set(auth(alice))
      .send({ ...body, operationKey: randomUUID() })
      .expect(201)
  ).body.id;
};
const revise = (id, body, user = alice) =>
  request(app).put(`/api/v1/trades/${id}`).set(auth(user)).send(body);
const detail = async (id, user = alice) =>
  (await request(app).get(`/api/v1/trades/${id}`).set(auth(user)).expect(200))
    .body;
const snapshot = async (id, version, user = alice) =>
  (
    await request(app)
      .get(`/api/v1/trades/${id}/versions/${version}`)
      .set(auth(user))
      .expect(200)
  ).body;
const edit = (revision, description = 'Revised synthetic details') =>
  request(app)
    .put(`/api/v1/listings/${items.get(alice.id)}`)
    .set(auth(alice))
    .send({
      revision,
      title: 'Synthetic item',
      description,
      condition: 'fair',
    });
const memberships = async (id) =>
  (
    await migration.query(
      'SELECT user_id,status,active FROM public.conversation_members WHERE conversation_id=$1 ORDER BY user_id',
      [id],
    )
  ).rows;
const failNotifications = async (enabled, groupOnly = false) => {
  if (enabled) {
    await migration.query(`CREATE FUNCTION public.synthetic_revision_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN IF ${groupOnly ? `NEW.event_type='${groupOnly === true ? 'group_invitation' : groupOnly}'` : 'true'} THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await migration.query(`CREATE TRIGGER synthetic_revision_failure BEFORE INSERT ON public.notifications
      FOR EACH ROW EXECUTE FUNCTION public.synthetic_revision_failure()`);
  } else {
    await migration.query(
      'DROP TRIGGER IF EXISTS synthetic_revision_failure ON public.notifications',
    );
    await migration.query(
      'DROP FUNCTION IF EXISTS public.synthetic_revision_failure()',
    );
  }
};
try {
  for (const user of fixture.users) {
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
    const id = randomUUID();
    items.set(user.id, id);
    await migration.query(
      `INSERT INTO public.listings (id,owner_id,title,description,condition)
      VALUES ($1,$2,'Synthetic item','Original synthetic details','good')`,
      [id, user.id],
    );
  }
  const id = await create();
  await request(app).put(`/api/v1/trades/${id}`).send(terms()).expect(401);
  await revise(id, terms(), outsider).expect(404);
  for (const input of [
    { ...terms(), expectedVersion: 0 },
    { ...terms(), actorId: outsider.id },
    { ...terms(), participantIds: [alice.id, alice.id] },
  ])
    await revise(id, input).expect(400);
  const forged = terms();
  forged.transfers[0].ownerId = bob.id;
  forged.transfers[0].recipientId = alice.id;
  forged.transfers[1].ownerId = alice.id;
  forged.transfers[1].recipientId = bob.id;
  await revise(id, forged).expect(422);
  await migration.query(
    'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
    [carol.id, alice.id],
  );
  await revise(id, terms([alice, bob, carol])).expect(403);
  await migration.query('DELETE FROM public.blocks WHERE blocker_id=$1', [
    carol.id,
  ]);
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [bob.id, 'synthetic'],
  );
  await revise(id, terms()).expect(403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );
  const original = await snapshot(id, 1);
  await migration.query(
    'UPDATE public.trade_participants SET accepted_version=1,accepted_at=now() WHERE trade_id=$1',
    [id],
  );
  const concurrent = await Promise.all([
    revise(id, terms()),
    revise(id, terms(), bob),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status).sort(),
    [200, 409],
  );
  assert.equal((await detail(id)).currentVersion, 2);
  assert.ok(
    (await detail(id)).participants.every(
      (p) => p.acceptedVersion === null && p.acceptedAt === null,
    ),
  );
  assert.deepEqual(await snapshot(id, 1), original);
  const swapped = terms([alice, bob], 2);
  // Use a replacement listing owned by the same participant.
  const replacement = randomUUID();
  await migration.query(
    `INSERT INTO public.listings (id,owner_id,title,description,condition)
    VALUES ($1,$2,'Replacement item','Synthetic replacement','good')`,
    [replacement, bob.id],
  );
  swapped.transfers[1].listingId = replacement;
  await revise(id, swapped, bob).expect(200);
  assert.equal(
    (await snapshot(id, 3)).items.find((item) => item.ownerId === bob.id)
      .listingId,
    replacement,
  );
  assert.equal(
    (await snapshot(id, 2)).items.find((item) => item.ownerId === bob.id)
      .listingId,
    items.get(bob.id),
  );
  await failNotifications(true, true);
  await revise(id, terms([alice, bob, carol], 3)).expect(500);
  await failNotifications(false);
  assert.equal((await detail(id)).currentVersion, 3);
  assert.equal((await detail(id)).groupConversationId, null);
  assert.equal(
    (
      await migration.query(
        'SELECT count(*)::int AS n FROM public.trade_versions WHERE trade_id=$1',
        [id],
      )
    ).rows[0].n,
    3,
  );
  await revise(id, terms([alice, bob, carol], 3)).expect(200);
  const group = (await detail(id)).groupConversationId;
  assert.ok(group);
  let members = await memberships(group);
  assert.equal(members.find((m) => m.user_id === carol.id).active, false);
  assert.equal(members.find((m) => m.user_id === carol.id).status, 'pending');
  await request(app)
    .put(`/api/v1/conversations/${group}/invitation/accept`)
    .set(auth(carol))
    .send({})
    .expect(200);
  const savedMessage = await request(app)
    .post('/api/v1/conversations/messages')
    .set(auth(carol))
    .send({
      conversation_id: group,
      client_message_id: randomUUID(),
      body: 'Synthetic history before removal',
    })
    .expect(200);
  const permittedHistory = await carol.client
    .from('messages')
    .select('id')
    .eq('id', savedMessage.body.id)
    .abortSignal(globalThis.AbortSignal.timeout(10_000));
  assert.equal(permittedHistory.error, null);
  assert.equal(permittedHistory.data.length, 1);
  await request(app)
    .put(`/api/v1/conversations/${group}/invitation/decline`)
    .set(auth(bob))
    .send({})
    .expect(200);
  const originalTransfers = (await snapshot(id, 4)).items;
  const retargeted = terms([alice, bob, carol], 4);
  retargeted.transfers.forEach((transfer, index) => {
    transfer.recipientId = retargeted.participantIds[(index + 2) % 3];
  });
  await migration.query(
    'UPDATE public.trade_participants SET accepted_version=4,accepted_at=now() WHERE trade_id=$1',
    [id],
  );
  await revise(id, retargeted).expect(200);
  const retargetedSnapshot = await snapshot(id, 5);
  for (const transfer of retargeted.transfers)
    assert.equal(
      retargetedSnapshot.items.find(
        (item) => item.listingId === transfer.listingId,
      ).recipientId,
      transfer.recipientId,
    );
  assert.deepEqual((await snapshot(id, 4)).items, originalTransfers);
  assert.ok(
    (await detail(id)).participants.every(
      (participant) => participant.acceptedVersion === null,
    ),
  );
  assert.equal(
    (await memberships(group)).find((m) => m.user_id === bob.id).status,
    'declined',
  );
  const groupBefore = await memberships(group);
  await failNotifications(true, true);
  await revise(id, terms([alice, bob, outsider], 5)).expect(500);
  await failNotifications(false);
  assert.deepEqual(await memberships(group), groupBefore);
  assert.equal((await detail(id)).currentVersion, 5);
  await revise(id, terms([alice, bob, outsider], 5)).expect(200);
  members = await memberships(group);
  assert.equal(members.find((m) => m.user_id === carol.id).status, 'left');
  assert.equal(members.find((m) => m.user_id === carol.id).active, false);
  assert.equal(
    members.find((m) => m.user_id === outsider.id).status,
    'pending',
  );
  assert.equal(members.find((m) => m.user_id === outsider.id).active, false);
  await request(app)
    .put(`/api/v1/conversations/${group}/invitation/accept`)
    .set(auth(carol))
    .send({})
    .expect(403);
  await revise(id, terms([alice, bob, carol], 6), carol).expect(404);
  await request(app).get(`/api/v1/trades/${id}`).set(auth(carol)).expect(404);
  await snapshot(id, 4, carol);
  await request(app)
    .get(`/api/v1/trades/${id}/versions/6`)
    .set(auth(carol))
    .expect(404);
  await request(app)
    .get(`/api/v1/trades/${id}/versions/1`)
    .set(auth(outsider))
    .expect(404);
  await revise(id, terms([alice, bob, carol], 6)).expect(200);
  assert.equal(
    (await memberships(group)).find((m) => m.user_id === carol.id).status,
    'pending',
  );
  assert.equal(
    (await memberships(group)).find((m) => m.user_id === carol.id).active,
    false,
  );
  const joinRace = await Promise.all([
    revise(id, terms([alice, bob, outsider], 7)),
    request(app)
      .put(`/api/v1/conversations/${group}/invitation/accept`)
      .set(auth(carol))
      .send({}),
  ]);
  assert.equal(joinRace[0].status, 200);
  assert.ok([200, 403].includes(joinRace[1].status));
  assert.equal(
    (await memberships(group)).find((m) => m.user_id === carol.id).active,
    false,
  );
  await request(app)
    .post('/api/v1/conversations/messages')
    .set(auth(carol))
    .send({
      conversation_id: group,
      client_message_id: randomUUID(),
      body: 'Revoked synthetic send',
    })
    .expect(403);
  const revokedRead = await carol.client
    .from('messages')
    .select('id')
    .eq('conversation_id', group)
    .abortSignal(globalThis.AbortSignal.timeout(10_000));
  assert.equal(revokedRead.error, null);
  assert.deepEqual(revokedRead.data, []);
  await revise(id, terms([alice, bob, carol], 8)).expect(200);
  // Competing listing and proposal edits serialize; both outcomes preserve fresh current snapshots.
  const before = (await detail(id)).currentVersion;
  await migration.query(
    'UPDATE public.trade_participants SET accepted_version=$2,accepted_at=now() WHERE trade_id=$1',
    [id, before],
  );
  const race = await Promise.all([
    revise(id, terms([alice, bob, carol], before)),
    edit(1),
  ]);
  assert.equal(race[1].status, 200);
  assert.ok([200, 409].includes(race[0].status));
  const current = await detail(id);
  assert.equal(
    current.currentVersion,
    before + (race[0].status === 200 ? 2 : 1),
  );
  assert.equal(
    current.items.find((item) => item.ownerId === alice.id).listingRevision,
    2,
  );
  assert.equal(
    current.items.find((item) => item.ownerId === alice.id).conditionSnapshot,
    'fair',
  );
  assert.ok(current.participants.every((p) => p.acceptedVersion === null));
  await revise(id, terms([alice, bob, carol], before)).expect(409);
  assert.equal(
    (await snapshot(id, 1)).items.find((item) => item.ownerId === alice.id)
      .conditionSnapshot,
    'good',
  );
  // Every affected proposal, snapshot and notification rolls back with a failed listing edit.
  const other = await create();
  const prior = await snapshot(id, current.currentVersion);
  await failNotifications(true);
  await edit(2, 'Failure must roll back').expect(500);
  await failNotifications(false);
  assert.equal((await detail(id)).currentVersion, current.currentVersion);
  assert.deepEqual(await snapshot(id, current.currentVersion), prior);
  assert.equal((await detail(other)).currentVersion, 1);
  await edit(2, 'Successful fresh terms').expect(200);
  assert.equal((await detail(other)).currentVersion, 2);
  await edit(2).expect(409);
  const noChangeVersion = (await detail(other)).currentVersion;
  await edit(3, 'Successful fresh terms').expect(200);
  assert.equal((await detail(other)).currentVersion, noChangeVersion);
  await assert.rejects(
    runtime.query(
      "UPDATE public.trade_items SET title_snapshot='tampered' WHERE trade_id=$1",
      [id],
    ),
  );
  await assert.rejects(
    migration.query(
      'UPDATE public.trade_versions SET participant_ids=$2 WHERE trade_id=$1',
      [id, [alice.id, outsider.id]],
    ),
  );
  await assert.rejects(
    migration.query('DELETE FROM public.trade_items WHERE trade_id=$1', [id]),
  );
  // Synthetic confirmed fixture; no confirmation workflow is implemented here.
  await migration.query(
    "UPDATE public.trades SET status='confirmed' WHERE id=$1",
    [other],
  );
  await revise(other, terms([alice, bob], 2)).expect(409);
  await assert.rejects(
    runtime.query("UPDATE public.trades SET status='proposed' WHERE id=$1", [
      other,
    ]),
  );
  await edit(3, 'Cannot revise a confirmed item').expect(409);
  await assert.rejects(
    runtime.query('UPDATE public.trades SET current_version=1 WHERE id=$1', [
      other,
    ]),
  );
  await assert.rejects(
    runtime.query(
      'UPDATE public.trade_participants SET active=false WHERE trade_id=$1',
      [other],
    ),
  );
  await assert.rejects(
    runtime.query(
      `INSERT INTO public.trade_versions (trade_id,version,created_by,participant_ids,expires_at)
    VALUES ($1,3,$2,$3,now()+interval '1 day')`,
      [other, alice.id, [alice.id, bob.id]],
    ),
  );
  const removalOnly = await create([alice, bob, carol]);
  const removalGroup = (await detail(removalOnly)).groupConversationId;
  for (const member of [bob, carol])
    await request(app)
      .put(`/api/v1/conversations/${removalGroup}/invitation/accept`)
      .set(auth(member))
      .send({})
      .expect(200);
  const removalSnapshot = await snapshot(removalOnly, 1, carol);
  const eventCount = async () =>
    (
      await migration.query(
        'SELECT count(*)::int AS n FROM public.conversation_membership_events WHERE conversation_id=$1',
        [removalGroup],
      )
    ).rows[0].n;
  const notificationCount = async () =>
    (
      await migration.query(
        "SELECT count(*)::int AS n FROM public.notifications WHERE resource_type='conversation' AND resource_id=$1",
        [removalGroup],
      )
    ).rows[0].n;
  const beforeRemoval = {
    members: await memberships(removalGroup),
    events: await eventCount(),
    notifications: await notificationCount(),
  };
  await failNotifications(true, 'group_membership');
  await revise(removalOnly, terms([alice, bob])).expect(500);
  await failNotifications(false);
  assert.deepEqual(await memberships(removalGroup), beforeRemoval.members);
  assert.equal(await eventCount(), beforeRemoval.events);
  assert.equal(await notificationCount(), beforeRemoval.notifications);
  assert.equal((await detail(removalOnly)).currentVersion, 1);
  await revise(removalOnly, terms([alice, bob])).expect(200);
  assert.equal(await eventCount(), beforeRemoval.events + 1);
  assert.equal(await notificationCount(), beforeRemoval.notifications + 3);
  const removalEvent = (
    await migration.query(
      "SELECT id,actor_id,affected_user_id FROM public.conversation_membership_events WHERE conversation_id=$1 AND event_type='removed'",
      [removalGroup],
    )
  ).rows[0];
  assert.equal(removalEvent.actor_id, alice.id);
  assert.equal(removalEvent.affected_user_id, carol.id);
  const removalNotifications = (
    await migration.query(
      'SELECT recipient_id,event_type,resource_type,resource_id FROM public.notifications WHERE domain_event_id=$1',
      [removalEvent.id],
    )
  ).rows;
  assert.deepEqual(
    new Set(removalNotifications.map((row) => row.recipient_id)),
    new Set([alice.id, bob.id, carol.id]),
  );
  assert.ok(
    removalNotifications.every(
      (row) =>
        row.event_type === 'group_membership' &&
        row.resource_type === 'conversation' &&
        row.resource_id === removalGroup,
    ),
  );
  assert.deepEqual(await snapshot(removalOnly, 1, carol), removalSnapshot);
  await request(app)
    .get(`/api/v1/trades/${removalOnly}/versions/2`)
    .set(auth(carol))
    .expect(404);
  await request(app)
    .get(`/api/v1/conversations/${removalGroup}/invitation`)
    .set(auth(carol))
    .expect(403);
  await revise(removalOnly, terms([alice, bob])).expect(409);
  assert.equal(await eventCount(), beforeRemoval.events + 1);
  const removedCreator = await create([alice, bob, carol]);
  await revise(removedCreator, terms([bob, carol]), bob).expect(200);
  await request(app)
    .get(`/api/v1/trades/${removedCreator}`)
    .set(auth(alice))
    .expect(404);
  await snapshot(removedCreator, 1, alice);
  await revise(removedCreator, terms(), alice).expect(404);
  const originalCreation = await snapshot(removedCreator, 1, alice);
  const originalKey = (
    await migration.query(
      'SELECT operation_key FROM public.trades WHERE id=$1',
      [removedCreator],
    )
  ).rows[0].operation_key;
  await request(app)
    .post('/api/v1/trades')
    .set(auth(alice))
    .send({
      operationKey: originalKey,
      participantIds: originalCreation.participantIds,
      transfers: originalCreation.items.map((item) => ({
        listingId: item.listingId,
        ownerId: item.ownerId,
        recipientId: item.recipientId,
      })),
      expiresAt: originalCreation.expiresAt,
      meetingMode: 'meet_to_swap',
    })
    .expect(404);
  const expired = await create();
  await migration.query(
    "UPDATE public.trades SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [expired],
  );
  await revise(expired, terms(), bob).expect(409);
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.equal(
      (
        await migration.query(
          "SELECT has_function_privilege($1,'private.reconcile_trade_group(uuid,uuid,uuid[])','EXECUTE') AS allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  console.info(
    'Local revision authorization, immutable history, stale races, listing coordination, group consent, frozen terms and rollback passed.',
  );
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  await failNotifications(false);
  await fixture.cleanup();
}
