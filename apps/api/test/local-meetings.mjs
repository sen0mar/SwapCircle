// Guarded local synthetic Auth/PostgreSQL integration and concurrency coverage.
import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  migration,
  runtime,
  users: [alice, bob, carol, outsider],
} = fixture;
const app = fixture.makeApp({
  allowance: 240,
  windowSeconds: 3600,
  burstMax: 400,
  burstWindowMs: 60000,
});
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const arrangement = {
  place: 'Synthetic public square',
  mapLink: 'https://maps.example.com/synthetic',
  meetingAt: '2026-10-25T00:30:00.000Z',
  timeZone: 'Europe/Paris',
};
const create = (trade, user = alice, extra = {}) =>
  request(app)
    .post(`/api/v1/trades/${trade}/meeting`)
    .set(auth(user))
    .send({
      ...arrangement,
      expectedTradeVersion: 1,
      operationKey: randomUUID(),
      ...extra,
    });
const read = (trade, user = alice) =>
  request(app).get(`/api/v1/trades/${trade}/meeting`).set(auth(user));
const update = (trade, revision, extra = {}, user = alice) =>
  request(app)
    .put(`/api/v1/trades/${trade}/meeting`)
    .set(auth(user))
    .send({
      ...arrangement,
      expectedTradeVersion: 1,
      expectedRevision: revision,
      operationKey: randomUUID(),
      ...extra,
    });
const respond = (trade, revision, user = bob, extra = {}) =>
  request(app)
    .post(`/api/v1/trades/${trade}/meeting/respond`)
    .set(auth(user))
    .send({
      expectedTradeVersion: 1,
      expectedRevision: revision,
      expectedResponse: null,
      response: 'confirmed',
      operationKey: randomUUID(),
      ...extra,
    });
const detail = async (id) =>
  (await request(app).get(`/api/v1/trades/${id}`).set(auth(alice)).expect(200))
    .body;
const count = async (id) =>
  Number(
    (
      await migration.query(
        'SELECT count(*) FROM public.notifications WHERE resource_id=$1',
        [id],
      )
    ).rows[0].count,
  );
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
    await migration.query(`CREATE FUNCTION public.synthetic_meeting_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='meeting_change' THEN RAISE EXCEPTION 'synthetic meeting notification failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER synthetic_meeting_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_meeting_failure();`);
  else
    await migration.query(
      'DROP TRIGGER IF EXISTS synthetic_meeting_failure ON public.notifications; DROP FUNCTION IF EXISTS public.synthetic_meeting_failure()',
    );
};

try {
  for (const user of [alice, bob, carol, outsider])
    await request(app)
      .put('/api/v1/profiles/me')
      .set(auth(user))
      .send({
        displayName: 'Synthetic meeting member',
        biography: '',
        approximateLocation: '',
        interestIds: [],
      })
      .expect(200);
  const trade = await make();
  const baseline = await detail(trade);
  assert.equal((await read(trade).expect(200)).body, null);
  await read(trade, outsider).expect(404);
  await create(trade, outsider).expect(404);
  await update(trade, 1, {}, outsider).expect(404);
  await respond(trade, 1, outsider).expect(404);
  for (const extra of [
    { userId: outsider.id },
    { meetingAt: '2026-02-30T00:00:00.000Z' },
    { timeZone: 'Europe/Invalid' },
    { mapLink: 'javascript:alert(1)' },
  ])
    await create(trade, alice, extra).expect(400);
  const key = randomUUID();
  const initial = await Promise.all([
    create(trade, alice, { operationKey: key }).expect(201),
    create(trade, alice, { operationKey: key }).expect(201),
  ]);
  assert.deepEqual(initial[0].body, initial[1].body);
  const meeting = initial[0].body;
  assert.equal(meeting.revision, 1);
  assert.ok(meeting.responses.every((r) => r.response === null));
  assert.equal(await count(meeting.id), 1);
  await create(trade, alice, { operationKey: key, place: 'Other' }).expect(409);
  await create(trade, bob).expect(409);
  for (const user of [alice, bob])
    assert.deepEqual(
      (
        await request(app)
          .get(`/api/v1/meetups/${meeting.id}`)
          .set(auth(user))
          .expect(200)
      ).body,
      meeting,
    );
  await request(app)
    .get(`/api/v1/meetups/${meeting.id}`)
    .set(auth(outsider))
    .expect(404);
  await request(app)
    .get(`/api/v1/meetups/${randomUUID()}`)
    .set(auth(alice))
    .expect(404);
  await request(app)
    .get('/api/v1/meetups/invalid')
    .set(auth(alice))
    .expect(400);
  const responseKey = randomUUID();
  const replies = await Promise.all([
    respond(trade, 1, bob, { operationKey: responseKey }).expect(200),
    respond(trade, 1, bob, { operationKey: responseKey }).expect(200),
  ]);
  assert.deepEqual(replies[0].body, replies[1].body);
  assert.equal(await count(meeting.id), 2);
  await respond(trade, 1, bob, {
    operationKey: responseKey,
    response: 'declined',
  }).expect(409);
  await respond(trade, 1, bob).expect(409);
  await respond(trade, 1, alice).expect(200);
  assert.ok(
    (await read(trade).expect(200)).body.responses.every(
      (r) => r.response === 'confirmed',
    ),
  );
  const beforeNoop = await count(meeting.id);
  assert.equal((await update(trade, 1).expect(200)).body.revision, 1);
  assert.equal(await count(meeting.id), beforeNoop);

  // Two writers using the same revision cannot overwrite one another.
  const race = await Promise.all([
    update(trade, 1, { place: 'Synthetic east square' }),
    update(trade, 1, { place: 'Synthetic west square' }, bob),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const revised = (await read(trade).expect(200)).body;
  assert.equal(revised.revision, 2);
  assert.ok(revised.responses.every((r) => r.response === null));
  await respond(trade, 1).expect(409);
  // Lost-response retries acknowledge a saved operation without restoring old consent/details.
  assert.deepEqual(
    (await respond(trade, 1, bob, { operationKey: responseKey }).expect(200))
      .body,
    revised,
  );
  assert.deepEqual(
    (await create(trade, alice, { operationKey: key }).expect(201)).body,
    revised,
  );
  assert.equal(await count(meeting.id), beforeNoop + 1);
  const updateKey = randomUUID();
  const timeChange = {
    place: revised.place,
    meetingAt: '2026-10-25T01:30:00.000Z',
    operationKey: updateKey,
  };
  const later = (await update(trade, 2, timeChange).expect(200)).body;
  assert.equal(later.revision, 3);
  assert.equal(later.meetingAt, '2026-10-25T01:30:00.000Z');
  assert.deepEqual(
    (await update(trade, 2, timeChange).expect(200)).body,
    later,
  );
  const changes = await Promise.all([
    respond(trade, 3, bob),
    respond(trade, 3, bob, { response: 'declined' }),
  ]);
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  const saved = (await read(trade).expect(200)).body.responses.find(
    (r) => r.userId === bob.id,
  ).response;
  await respond(trade, 3, bob, {
    expectedResponse: saved,
    response: saved === 'confirmed' ? 'declined' : 'confirmed',
  }).expect(200);
  assert.deepEqual(await detail(trade), baseline);
  assert.equal(
    (
      await migration.query(
        'SELECT * FROM public.item_reservations WHERE trade_id=$1',
        [trade],
      )
    ).rowCount,
    0,
  );

  // Notification payloads contain no place, link, instant, zone or response.
  const notifications = (
    await migration.query(
      'SELECT * FROM public.notifications WHERE resource_id=$1',
      [meeting.id],
    )
  ).rows;
  const serialized = JSON.stringify(notifications);
  for (const text of [
    arrangement.place,
    arrangement.mapLink,
    arrangement.meetingAt,
    arrangement.timeZone,
  ])
    assert.ok(!serialized.includes(text));
  assert.ok(
    notifications.every(
      (n) => n.event_type === 'meeting_change' && n.resource_type === 'meetup',
    ),
  );
  const notificationReader = await migration.connect();
  try {
    await notificationReader.query('BEGIN');
    await notificationReader.query(
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      [outsider.id],
    );
    await notificationReader.query('SET LOCAL ROLE authenticated');
    assert.equal(
      (
        await notificationReader.query(
          'SELECT * FROM public.notifications WHERE resource_id=$1',
          [meeting.id],
        )
      ).rowCount,
      0,
    );
  } finally {
    await notificationReader.query('ROLLBACK');
    notificationReader.release();
  }

  const mapOnly = await make();
  const mapProposal = (
    await create(mapOnly, alice, { place: undefined }).expect(201)
  ).body;
  assert.equal(mapProposal.place, null);
  await update(mapOnly, 1, { place: null, mapLink: null }).expect(400);

  const rollback = await make();
  const rollbackKey = randomUUID();
  await failure(true);
  await create(rollback, alice, { operationKey: rollbackKey }).expect(500);
  assert.equal((await read(rollback).expect(200)).body, null);
  await failure(false);
  const recovered = (
    await create(rollback, alice, { operationKey: rollbackKey }).expect(201)
  ).body;
  const rollbackCount = await count(recovered.id);
  await failure(true);
  await update(rollback, 1, { place: 'Synthetic changed square' }).expect(500);
  await respond(rollback, 1).expect(500);
  assert.deepEqual((await read(rollback).expect(200)).body, recovered);
  assert.equal(await count(recovered.id), rollbackCount);
  await failure(false);
  await respond(rollback, 1).expect(200);

  // A response racing an arrangement update either commits before invalidation,
  // or rejects the old revision. Neither ordering confirms the new arrangement.
  const responseRace = await Promise.all([
    respond(rollback, 1, alice),
    update(rollback, 1, { place: 'Synthetic next square' }),
  ]);
  assert.equal(responseRace[1].status, 200);
  assert.ok([200, 409].includes(responseRace[0].status));
  assert.ok(
    (await read(rollback).expect(200)).body.responses.every(
      (r) => r.response === null,
    ),
  );

  // Meeting planning does not modify independent coffee consent or trade reservations.
  const ids = (
    await migration.query('SELECT id FROM public.interests ORDER BY id LIMIT 2')
  ).rows.map((r) => r.id);
  for (const user of [alice, bob])
    for (const id of ids)
      await migration.query(
        'INSERT INTO public.profile_interests VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [user.id, id],
      );
  const coffee = (
    await request(app)
      .post(`/api/v1/trades/${trade}/coffee`)
      .set(auth(alice))
      .send({ inviteeId: bob.id, operationKey: randomUUID() })
      .expect(201)
  ).body;
  await request(app)
    .post(`/api/v1/trades/${trade}/coffee/${coffee.id}/respond`)
    .set(auth(bob))
    .send({ action: 'accept' })
    .expect(200);
  const coffeeBefore = (
    await request(app)
      .get(`/api/v1/coffee/${coffee.id}`)
      .set(auth(alice))
      .expect(200)
  ).body;
  for (const user of [alice, bob])
    await request(app)
      .post(`/api/v1/trades/${trade}/accept`)
      .set(auth(user))
      .send({ expectedVersion: 1, operationKey: randomUUID() })
      .expect(200);
  const confirmed = await detail(trade);
  const reservations = (
    await migration.query(
      'SELECT * FROM public.item_reservations WHERE trade_id=$1 ORDER BY id',
      [trade],
    )
  ).rows;
  await update(trade, 3, { meetingAt: '2026-03-29T01:30:00.000Z' }).expect(200);
  await respond(trade, 4, bob, { response: 'declined' }).expect(200);
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
  assert.deepEqual(
    (
      await request(app)
        .get(`/api/v1/coffee/${coffee.id}`)
        .set(auth(alice))
        .expect(200)
    ).body,
    coffeeBefore,
  );

  const group = await make([alice, bob, carol]);
  const groupMeeting = (await create(group).expect(201)).body;
  assert.equal(groupMeeting.responses.length, 3);
  assert.equal(await count(groupMeeting.id), 2);
  const departedResponseKey = randomUUID();
  await respond(group, 1, carol, { operationKey: departedResponseKey }).expect(
    200,
  );
  await respond(group, 1, bob).expect(200);
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
  await read(group, carol).expect(404);
  await request(app)
    .get(`/api/v1/meetups/${groupMeeting.id}`)
    .set(auth(carol))
    .expect(404);
  await respond(group, 1, carol).expect(404);
  await respond(group, 1, bob).expect(409);
  const groupCurrent = (await read(group).expect(200)).body;
  assert.equal(groupCurrent.tradeVersion, 2);
  assert.equal(groupCurrent.responses.length, 2);
  assert.equal(
    groupCurrent.responses.find((r) => r.userId === bob.id).response,
    'confirmed',
  );
  assert.equal(
    groupCurrent.responses.find((r) => r.userId === alice.id).response,
    null,
  );
  await respond(group, 1, bob, {
    expectedTradeVersion: 2,
    expectedResponse: 'confirmed',
    response: 'declined',
  }).expect(200);
  // Rejoining cannot revive a response from a previous uninterrupted membership.
  await request(app)
    .put(`/api/v1/trades/${group}`)
    .set(auth(alice))
    .send({
      expectedVersion: 2,
      participantIds: [alice.id, bob.id, carol.id],
      transfers: departure.items.map((i) => ({
        listingId: i.listingId,
        ownerId: i.ownerId,
        recipientId: i.recipientId,
      })),
      meetingMode: 'meet_to_swap',
      expiresAt: departure.expiresAt,
    })
    .expect(200);
  const rejoined = (await read(group, carol).expect(200)).body;
  assert.equal(
    rejoined.responses.find((r) => r.userId === carol.id).response,
    null,
  );
  assert.deepEqual(
    (
      await respond(group, 1, carol, {
        operationKey: departedResponseKey,
      }).expect(200)
    ).body,
    rejoined,
  );
  await respond(group, 1, carol, { expectedTradeVersion: 3 }).expect(200);
  for (const action of [
    () => read(group),
    () => update(group, 1, { expectedTradeVersion: 3 }),
  ]) {
    await migration.query(
      "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'Synthetic')",
      [alice.id],
    );
    await action().expect(403);
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id=$1',
      [alice.id],
    );
  }
  const expired = await make();
  await migration.query(
    "UPDATE public.trades SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [expired],
  );
  await create(expired).expect(409);

  for (const table of ['meetups', 'meetup_responses', 'meetup_operations']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const client = await migration.connect();
      try {
        for (const sql of [
          `SELECT * FROM public.${table}`,
          `DELETE FROM public.${table}`,
        ]) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query(sql), { code: '42501' });
          await client.query('ROLLBACK');
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
    await assert.rejects(runtime.query(`DELETE FROM public.${table}`), {
      code: '42501',
    });
    // RLS still denies browser reads even if a grant is accidentally added.
    const client = await migration.connect();
    try {
      await client.query('BEGIN');
      await client.query(`GRANT SELECT ON public.${table} TO authenticated`);
      await client.query('SET LOCAL ROLE authenticated');
      assert.equal(
        (await client.query(`SELECT * FROM public.${table}`)).rowCount,
        0,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }
  console.log(
    'Private meetings: authorization, exact DST instants, revisions, independent consent, idempotency/lost responses, concurrent writers/responses, atomic notification rollback, membership/restrictions, grants and RLS passed.',
  );
} finally {
  await failure(false);
  await fixture.cleanup();
}
