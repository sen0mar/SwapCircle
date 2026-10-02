// Guarded local Auth/PostgreSQL fixture; all accounts and content are synthetic.
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  migration,
  runtime,
  users: [alice, bob, carol, outsider],
} = fixture;
// This isolated authorization/concurrency suite sends more than one burst budget.
// Production limits and the dedicated safety tests remain unchanged.
const app = fixture.makeApp({
  allowance: 120,
  windowSeconds: 3600,
  burstMax: 240,
  burstWindowMs: 60000,
});
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const send = (
  trade,
  user = alice,
  other = bob,
  key = randomUUID(),
  offerToPay = false,
  extra = {},
) =>
  request(app)
    .post(`/api/v1/trades/${trade}/coffee`)
    .set(auth(user))
    .send({ inviteeId: other.id, operationKey: key, offerToPay, ...extra });
const respond = (trade, id, action, user = bob) =>
  request(app)
    .post(`/api/v1/trades/${trade}/coffee/${id}/respond`)
    .set(auth(user))
    .send({ action });
const eligibility = (trade, user = alice, other = bob) =>
  request(app)
    .get(`/api/v1/trades/${trade}/coffee/eligibility`)
    .query({ inviteeId: other.id })
    .set(auth(user));
const list = (trade, user = alice) =>
  request(app).get(`/api/v1/trades/${trade}/coffee`).set(auth(user));
const detail = async (id) =>
  (await request(app).get(`/api/v1/trades/${id}`).set(auth(alice)).expect(200))
    .body;
const interests = (
  await migration.query('SELECT id FROM public.interests ORDER BY id LIMIT 3')
).rows.map((r) => r.id);
const setInterests = async (user, ids) => {
  const result = await request(app)
    .put('/api/v1/profiles/me')
    .set(auth(user))
    .send({
      displayName: 'Synthetic member',
      biography: '',
      approximateLocation: '',
      interestIds: ids,
    });
  assert.equal(result.status, 200);
};
const notifications = async (id) =>
  (
    await migration.query(
      'SELECT event_type,recipient_id FROM public.notifications WHERE resource_id=$1 ORDER BY created_at,id',
      [id],
    )
  ).rows;
const make = async (members = [alice, bob]) => {
  const transfers = [];
  for (const [i, user] of members.entries()) {
    const id = randomUUID();
    await migration.query(
      "INSERT INTO public.listings (id,owner_id,title,description,condition) VALUES ($1,$2,'Synthetic coffee item','Synthetic only','good')",
      [id, user.id],
    );
    transfers.push({
      listingId: id,
      ownerId: user.id,
      recipientId: members[(i + 1) % members.length].id,
    });
  }
  return (
    await request(app)
      .post('/api/v1/trades')
      .set(auth(alice))
      .send({
        participantIds: members.map((u) => u.id),
        transfers,
        operationKey: randomUUID(),
        meetingMode: 'meet_to_swap',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })
      .expect(201)
  ).body.id;
};
const failure = async (enabled) => {
  if (enabled)
    await migration.query(`CREATE FUNCTION public.synthetic_coffee_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('coffee_invitation','coffee_response') THEN RAISE EXCEPTION 'synthetic coffee notification failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER synthetic_coffee_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_coffee_failure();`);
  else
    await migration.query(
      'DROP TRIGGER IF EXISTS synthetic_coffee_failure ON public.notifications; DROP FUNCTION IF EXISTS public.synthetic_coffee_failure()',
    );
};

try {
  for (const user of [alice, bob, carol, outsider])
    await setInterests(user, []);
  const trade = await make();
  const baseline = await detail(trade);
  await setInterests(alice, interests);
  for (const count of [0, 1, 2]) {
    await setInterests(bob, interests.slice(0, count));
    const result = await eligibility(trade).expect(200);
    assert.equal(result.body.eligible, count >= 2);
    assert.equal(result.body.sharedInterests.length, count);
    if (count < 2)
      assert.equal(
        (await send(trade).expect(409)).body.error.code,
        'COFFEE_INELIGIBLE',
      );
  }
  // Repeated tags cannot turn one distinct interest into two.
  await request(app)
    .put('/api/v1/profiles/me')
    .set(auth(bob))
    .send({
      displayName: 'Synthetic',
      biography: '',
      approximateLocation: '',
      interestIds: [interests[0], interests[0]],
    })
    .expect(400);
  await assert.rejects(
    migration.query('INSERT INTO public.profile_interests VALUES ($1,$2)', [
      bob.id,
      interests[0],
    ]),
    { code: '23505' },
  );
  await send(trade, alice, alice).expect(422);
  await send(trade, alice, outsider).expect(422);
  await send(trade, outsider, alice).expect(404);
  await eligibility(trade, outsider, alice).expect(404);
  await list(trade, outsider).expect(404);
  await send(trade, alice, bob, randomUUID(), false, {
    inviterId: outsider.id,
  }).expect(400);
  await request(app)
    .post(`/api/v1/trades/${trade}/coffee`)
    .send({ inviteeId: bob.id, operationKey: randomUUID() })
    .expect(401);

  const key = randomUUID();
  const created = await Promise.all([
    send(trade, alice, bob, key, true).expect(201),
    send(trade, alice, bob, key, true).expect(201),
  ]);
  assert.deepEqual(created[0].body, created[1].body);
  const invitation = created[0].body;
  assert.equal(invitation.offerToPay, true);
  assert.equal(invitation.status, 'pending');
  assert.equal(invitation.inviterId, alice.id);
  assert.equal((await notifications(invitation.id)).length, 1);
  await send(trade, alice, bob, key, false).expect(409);
  await send(trade, bob, alice).expect(409);
  await respond(trade, invitation.id, 'accept', alice).expect(403);
  await respond(trade, invitation.id, 'accept', outsider).expect(404);
  await respond(trade, invitation.id, 'accept', carol).expect(404);
  await respond(trade, invitation.id, 'cancel', bob).expect(409);
  await setInterests(bob, interests.slice(0, 1));
  assert.equal(
    (await respond(trade, invitation.id, 'accept').expect(409)).body.error.code,
    'COFFEE_INELIGIBLE',
  );
  assert.equal((await list(trade).expect(200)).body[0].status, 'pending');
  await setInterests(bob, interests.slice(0, 2));

  for (const [first, second] of [
    [alice, bob],
    [bob, alice],
  ]) {
    await migration.query(
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
      [first.id, second.id],
    );
    await eligibility(trade).expect(403);
    await respond(trade, invitation.id, 'accept').expect(403);
    await migration.query(
      'DELETE FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
      [first.id, second.id],
    );
  }
  for (const user of [alice, bob]) {
    await migration.query(
      "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'Synthetic')",
      [user.id],
    );
    await eligibility(trade).expect(403);
    await respond(trade, invitation.id, 'accept').expect(403);
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id=$1',
      [user.id],
    );
  }
  await failure(true);
  await respond(trade, invitation.id, 'accept').expect(500);
  assert.equal((await list(trade).expect(200)).body[0].status, 'pending');
  assert.equal((await notifications(invitation.id)).length, 1);
  await failure(false);
  const accepted = await Promise.all([
    respond(trade, invitation.id, 'accept').expect(200),
    respond(trade, invitation.id, 'accept').expect(200),
  ]);
  assert.deepEqual(accepted[0].body, accepted[1].body);
  assert.equal((await notifications(invitation.id)).length, 2);
  assert.equal(accepted[0].body.status, 'accepted');
  await setInterests(bob, []);
  assert.equal((await eligibility(trade).expect(200)).body.eligible, false);
  assert.deepEqual(
    (await respond(trade, invitation.id, 'accept').expect(200)).body,
    accepted[0].body,
  );
  assert.equal((await notifications(invitation.id)).length, 2);
  assert.deepEqual(await detail(trade), baseline);

  // Explicit trade agreement/reservations remain intact after coffee cancellation.
  for (const user of [alice, bob])
    await request(app)
      .post(`/api/v1/trades/${trade}/accept`)
      .set(auth(user))
      .send({ operationKey: randomUUID(), expectedVersion: 1 })
      .expect(200);
  const confirmed = await detail(trade);
  const reservations = (
    await migration.query(
      'SELECT * FROM public.item_reservations WHERE trade_id=$1 ORDER BY id',
      [trade],
    )
  ).rows;
  assert.equal(reservations.length, 2);
  await respond(trade, invitation.id, 'cancel').expect(200);
  await respond(trade, invitation.id, 'cancel').expect(200);
  assert.equal((await notifications(invitation.id)).length, 3);
  assert.deepEqual(await detail(trade), confirmed);
  assert.deepEqual(
    (
      await migration.query(
        'SELECT * FROM public.item_reservations WHERE trade_id=$1 ORDER BY id',
        [trade],
      )
    ).rows,
    reservations,
  );
  await respond(trade, invitation.id, 'accept').expect(409);

  await setInterests(bob, interests.slice(0, 2));
  const group = await make([alice, bob, carol]);
  const groupBaseline = await detail(group);
  await setInterests(carol, [interests[1], interests[2]]);
  const ab = (await send(group).expect(201)).body;
  const ac = (await send(group, alice, carol).expect(201)).body;
  assert.equal(
    (await eligibility(group, bob, carol).expect(200)).body.eligible,
    false,
  );
  await send(group, bob, carol).expect(409);
  // Pending group/trade invitations grant no implicit coffee consent.
  assert.ok(
    (await list(group, carol).expect(200)).body.every(
      (i) => i.status === 'pending',
    ),
  );
  await respond(group, ab.id, 'accept', carol).expect(404);
  await respond(group, ab.id, 'decline').expect(200);
  await respond(group, ab.id, 'decline').expect(200);
  assert.equal((await notifications(ab.id)).length, 2);
  await respond(group, ac.id, 'accept', carol).expect(200);
  assert.equal(
    (await list(group).expect(200)).body.find((i) => i.id === ab.id).status,
    'declined',
  );
  assert.equal(
    (await list(group).expect(200)).body.find((i) => i.id === ac.id).status,
    'accepted',
  );
  assert.deepEqual(await detail(group), groupBaseline);

  const rollback = await make();
  const rollbackKey = randomUUID();
  await failure(true);
  await send(rollback, alice, bob, rollbackKey).expect(500);
  assert.deepEqual((await list(rollback).expect(200)).body, []);
  await failure(false);
  const retry = (await send(rollback, alice, bob, rollbackKey).expect(201))
    .body;
  assert.equal((await notifications(retry.id)).length, 1);
  await respond(rollback, retry.id, 'cancel', alice).expect(200);

  const competing = await make();
  const competingSends = await Promise.all([
    send(competing),
    send(competing, bob, alice),
  ]);
  assert.deepEqual(competingSends.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await list(competing).expect(200)).body.length, 1);

  const blockedSend = await make();
  await migration.query(
    'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
    [bob.id, alice.id],
  );
  await send(blockedSend).expect(403);
  await migration.query(
    'DELETE FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
    [bob.id, alice.id],
  );
  await migration.query(
    "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'Synthetic')",
    [bob.id],
  );
  await send(blockedSend).expect(403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );
  assert.deepEqual((await list(blockedSend).expect(200)).body, []);

  const isolated = await make();
  await respond(isolated, ac.id, 'accept', carol).expect(404);
  // A departed group member cannot read or consent through the coffee API.
  const departure = await detail(group);
  await request(app)
    .put(`/api/v1/trades/${group}`)
    .set(auth(alice))
    .send({
      expectedVersion: departure.currentVersion,
      participantIds: [alice.id, bob.id],
      transfers: departure.items
        .filter((i) => i.ownerId !== carol.id)
        .map((i) => ({
          listingId: i.listingId,
          ownerId: i.ownerId,
          recipientId: i.ownerId === alice.id ? bob.id : alice.id,
        })),
      meetingMode: 'meet_to_swap',
      expiresAt: departure.expiresAt,
    })
    .expect(200);
  await list(group, carol).expect(404);
  await eligibility(group, alice, carol).expect(422);
  await respond(group, ac.id, 'cancel', carol).expect(404);
  await send(group, alice, carol).expect(422);

  const racing = await make();
  const holder = await migration.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id FROM public.profiles WHERE id=$1 FOR UPDATE',
      [bob.id],
    );
    await holder.query(
      'DELETE FROM public.profile_interests WHERE profile_id=$1 AND interest_id=$2',
      [bob.id, interests[1]],
    );
    let settled = false;
    const sending = send(racing).then((r) => {
      settled = true;
      return r;
    });
    await delay(100);
    assert.equal(settled, false);
    await holder.query('COMMIT');
    assert.equal((await sending).status, 409);
    assert.deepEqual((await list(racing).expect(200)).body, []);
  } finally {
    await holder.query('ROLLBACK');
    holder.release();
  }

  for (const role of ['anon', 'authenticated', 'service_role']) {
    const client = await migration.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        client.query('SELECT * FROM public.coffee_invitations'),
        { code: '42501' },
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        client.query("UPDATE public.coffee_invitations SET status='accepted'"),
        { code: '42501' },
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  await assert.rejects(runtime.query('DELETE FROM public.coffee_invitations'), {
    code: '42501',
  });
  assert.ok(
    !JSON.stringify((await list(group).expect(200)).body).includes(
      'operationKey',
    ),
  );
  console.log(
    'Coffee consent: distinct 0/1/2 interests, duplicate tags, pair authorization, independent group pairs, send/response retries, concurrent profile edits, restrictions/blocks, atomic notification rollback, private grants/RLS and unchanged trade reservations passed.',
  );
} finally {
  await failure(false);
  await fixture.cleanup();
}
