// Isolated local Supabase stack and synthetic accounts only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import request from 'supertest';
import { proposalCreationResultSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  app,
  migration,
  users: [alice, bob, carol, outsider],
} = fixture;
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const items = new Map();
const post = (user, body) =>
  request(app).post('/api/v1/trades').set(auth(user)).send(body);

const make = (members = [alice, bob]) => ({
  operationKey: randomUUID(),
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  participantIds: members.map((member) => member.id),
  transfers: members.map((member, index) => ({
    listingId: items.get(member.id),
    ownerId: member.id,
    recipientId: members[(index + 1) % members.length].id,
  })),
  meetingMode: 'meet_to_swap',
});

const rows = async (table, tradeId) => {
  const result = await migration.query(
    `SELECT count(*)::int AS count FROM public.${table} WHERE trade_id=$1`,
    [tradeId],
  );
  return result.rows[0].count;
};

try {
  for (const user of [alice, bob, carol, outsider]) {
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
    const listingId = randomUUID();
    items.set(user.id, listingId);
    await migration.query(
      `INSERT INTO public.listings (id,owner_id,title,description,condition)
       VALUES ($1,$2,'Synthetic proposal item','Local proposal test','good')`,
      [listingId, user.id],
    );
  }

  await request(app).post('/api/v1/trades').send(make()).expect(401);
  const direct = make();
  const concurrent = await Promise.all([
    post(alice, direct),
    post(alice, direct),
  ]);
  assert.ok(concurrent.every((response) => response.status === 201));
  const first = proposalCreationResultSchema.parse(concurrent[0].body);
  assert.deepEqual(concurrent[0].body, concurrent[1].body);
  assert.equal(await rows('trade_versions', first.id), 1);
  assert.equal(await rows('trade_participants', first.id), 2);
  assert.equal(await rows('trade_items', first.id), 2);
  assert.equal(await rows('trade_events', first.id), 1);

  const detail = (
    await request(app)
      .get(`/api/v1/trades/${first.id}`)
      .set(auth(bob))
      .expect(200)
  ).body;
  assert.equal(detail.status, 'proposed');
  assert.ok(
    detail.items.every((item) => item.currentAvailability === 'available'),
  );
  assert.equal(
    detail.participants.find((member) => member.userId === bob.id)
      .invitationStatus,
    'invited',
  );
  assert.ok(
    detail.participants.every((member) => member.acceptedVersion === null),
  );
  await request(app)
    .get(`/api/v1/trades/${first.id}`)
    .set(auth(outsider))
    .expect(404);
  const invitations = await migration.query(
    `SELECT recipient_id,domain_event_id FROM public.notifications
     WHERE resource_type='trade' AND resource_id=$1`,
    [first.id],
  );
  assert.equal(invitations.rowCount, 1);
  assert.equal(invitations.rows[0].recipient_id, bob.id);
  assert.equal(
    (
      await migration.query(
        'SELECT count(*)::int AS count FROM public.listings WHERE id=ANY($1::uuid[]) AND availability=$2',
        [[items.get(alice.id), items.get(bob.id)], 'available'],
      )
    ).rows[0].count,
    2,
  );

  const changed = {
    ...direct,
    expiresAt: new Date(Date.now() + 172800_000).toISOString(),
  };
  assert.equal((await post(alice, changed)).status, 409);
  assert.equal((await post(outsider, direct)).status, 422);

  const forged = make();
  forged.transfers[0].ownerId = bob.id;
  forged.transfers[0].recipientId = alice.id;
  forged.transfers[1].ownerId = alice.id;
  forged.transfers[1].recipientId = bob.id;
  assert.equal((await post(alice, forged)).status, 422);
  const repeated = make();
  repeated.transfers[1].listingId = repeated.transfers[0].listingId;
  assert.equal((await post(alice, repeated)).status, 400);
  const self = make();
  self.transfers[0].recipientId = alice.id;
  assert.equal((await post(alice, self)).status, 400);

  await migration.query(
    "UPDATE public.listings SET availability='withdrawn' WHERE id=$1",
    [items.get(bob.id)],
  );
  const withdrawnDetail = (
    await request(app)
      .get(`/api/v1/trades/${first.id}`)
      .set(auth(alice))
      .expect(200)
  ).body;
  assert.equal(
    withdrawnDetail.items.find((item) => item.ownerId === bob.id)
      .currentAvailability,
    'withdrawn',
  );
  assert.equal((await post(alice, make())).status, 409);
  await migration.query(
    "UPDATE public.listings SET availability='available' WHERE id=$1",
    [items.get(bob.id)],
  );

  await migration.query(
    'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
    [carol.id, alice.id],
  );
  assert.equal((await post(alice, make([alice, bob, carol]))).status, 403);
  await migration.query(
    'DELETE FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
    [carol.id, alice.id],
  );
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [carol.id, 'synthetic test'],
  );
  assert.equal((await post(alice, make([alice, bob, carol]))).status, 403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [carol.id],
  );

  const group = make([alice, bob, carol]);
  const result = await post(alice, group).expect(201);
  assert.equal(await rows('trade_items', result.body.id), 3);
  assert.equal(
    (
      await migration.query(
        "SELECT count(*)::int AS count FROM public.notifications WHERE resource_type='trade' AND resource_id=$1",
        [result.body.id],
      )
    ).rows[0].count,
    2,
  );

  await migration.query(`CREATE FUNCTION public.synthetic_proposal_notification_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic notification failure'; END $$`);
  await migration.query(`CREATE TRIGGER synthetic_proposal_notification_failure BEFORE INSERT ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION public.synthetic_proposal_notification_failure()`);
  const failed = make();
  assert.equal((await post(alice, failed)).status, 500);
  await migration.query(
    'DROP TRIGGER synthetic_proposal_notification_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION public.synthetic_proposal_notification_failure()',
  );
  assert.equal(
    (
      await migration.query(
        'SELECT count(*)::int AS count FROM public.trades WHERE creator_id=$1 AND operation_key=$2',
        [alice.id, failed.operationKey],
      )
    ).rows[0].count,
    0,
  );
  assert.equal(
    (
      await migration.query(
        'SELECT count(*)::int AS count FROM public.notifications WHERE recipient_id=$1 AND resource_type=$2',
        [bob.id, 'trade'],
      )
    ).rows[0].count,
    2,
  );
  await post(alice, failed).expect(201);

  console.info(
    'Local proposal creation, retry, privacy, validation, and rollback passed.',
  );
} finally {
  await migration.query(
    'DROP TRIGGER IF EXISTS synthetic_proposal_notification_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION IF EXISTS public.synthetic_proposal_notification_failure()',
  );
  await fixture.cleanup();
}
