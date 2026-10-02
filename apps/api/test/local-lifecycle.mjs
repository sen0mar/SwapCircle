// Real guarded synthetic PostgreSQL, runtime role and verified local Auth tokens.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  migration,
  runtime,
  users: [alice, bob, carol, outsider],
} = fixture;
// This long isolated concurrency suite uses a larger injected fixture burst budget.
// Production rate limits and the dedicated safety suite stay unchanged.
const application = fixture.makeApp({
  allowance: 120,
  windowSeconds: 3600,
  burstMax: 240,
  burstWindowMs: 60000,
});
const app = application.listen(0, '127.0.0.1');
await once(app, 'listening');
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const accept = (
  id,
  user = alice,
  key = randomUUID(),
  version = 1,
  extra = {},
  targetApp = app,
) =>
  request(targetApp)
    .post(`/api/v1/trades/${id}/accept`)
    .set(auth(user))
    .send({ operationKey: key, expectedVersion: version, ...extra });
const detail = async (id) =>
  (await request(app).get(`/api/v1/trades/${id}`).set(auth(alice)).expect(200))
    .body;
const make = async (
  members = [alice, bob],
  shared = null,
  expiryMs = 86400000,
) => {
  const transfers = [];
  for (const [index, user] of members.entries()) {
    const listingId = index === 0 && shared ? shared : randomUUID();
    if (!(index === 0 && shared))
      await migration.query(
        `INSERT INTO public.listings (id,owner_id,title,description,condition)
        VALUES ($1,$2,'Synthetic item','Synthetic acceptance terms','good')`,
        [listingId, user.id],
      );
    transfers.push({
      listingId,
      ownerId: user.id,
      recipientId: members[(index + 1) % members.length].id,
    });
  }
  const terms = {
    participantIds: members.map((u) => u.id),
    transfers,
    meetingMode: 'meet_to_swap',
    expiresAt: new Date(Date.now() + expiryMs).toISOString(),
  };
  const result = await request(app)
    .post('/api/v1/trades')
    .set(auth(alice))
    .send({ ...terms, operationKey: randomUUID() })
    .expect(201);
  return { id: result.body.id, terms };
};
const count = async (table, id, where = '') =>
  (
    await migration.query(
      `SELECT count(*)::int AS n FROM public.${table} WHERE trade_id=$1 ${where}`,
      [id],
    )
  ).rows[0].n;
const transition = (
  id,
  action = 'cancel',
  user = alice,
  version = 1,
  extra = {},
) =>
  request(app)
    .post(`/api/v1/trades/${id}/${action}`)
    .set(auth(user))
    .send({ expectedVersion: version, ...extra });
const status = async (id) =>
  (await migration.query('SELECT status FROM public.trades WHERE id=$1', [id]))
    .rows[0].status;
const active = (id) =>
  count('item_reservations', id, 'AND released_at IS NULL');
const closeEvents = (id, kind) =>
  count('trade_events', id, `AND event_type='${kind}'`);
const confirm = async (members = [alice, bob]) => {
  const trade = await make(members);
  for (const member of members) await accept(trade.id, member).expect(200);
  return trade;
};
const evidence = async (client, id, type, user = bob) =>
  client.query(
    `INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type)
   SELECT trade_id,id,$2,$3 FROM public.trade_versions WHERE trade_id=$1 AND version=1`,
    [id, user.id, type],
  );
const released = async (trade) => {
  assert.equal(await status(trade.id), 'cancelled');
  assert.equal(await active(trade.id), 0);
  assert.equal(await closeEvents(trade.id, 'cancelled'), 1);
  const items = (await detail(trade.id)).items;
  assert.ok(items.every((i) => i.currentAvailability === 'available'));
};
try {
  for (const user of fixture.users)
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);

  const proposed = await make();
  await request(app)
    .post(`/api/v1/trades/${proposed.id}/cancel`)
    .send({ expectedVersion: 1 })
    .expect(401);
  await transition(proposed.id, 'cancel', outsider).expect(404);
  await transition(proposed.id, 'cancel', alice, 1, { actorId: bob.id }).expect(
    400,
  );
  await transition(proposed.id, 'cancel', alice, 2).expect(409);
  await transition(proposed.id, 'expire').expect(409);
  await migration.query(
    "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'synthetic')",
    [alice.id],
  );
  await transition(proposed.id).expect(403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [alice.id],
  );
  await transition(proposed.id, 'decline', bob).expect(200);
  await transition(proposed.id, 'decline', bob).expect(200);
  assert.equal(await status(proposed.id), 'declined');
  assert.equal(await closeEvents(proposed.id, 'declined'), 1);
  assert.equal(await active(proposed.id), 0);
  assert.equal(
    (await detail(proposed.id)).participants.find((p) => p.userId === bob.id)
      .invitationStatus,
    'declined',
  );
  await transition(proposed.id).expect(409);
  await accept(proposed.id).expect(409);

  const cancelledProposal = await make();
  await transition(cancelledProposal.id).expect(200);
  await transition(cancelledProposal.id, 'cancel', bob).expect(200);
  await released(cancelledProposal);
  for (const members of [
    [alice, bob],
    [alice, bob, carol],
  ]) {
    const confirmed = await confirm(members);
    await transition(confirmed.id, 'decline', bob).expect(409);
    await transition(confirmed.id, 'expire').expect(409);
    const before = await count('trade_acceptances', confirmed.id);
    const results = await Promise.all([
      transition(confirmed.id),
      transition(confirmed.id, 'cancel', bob),
    ]);
    assert.ok(results.every((r) => r.status === 200));
    await released(confirmed);
    assert.equal(await count('trade_acceptances', confirmed.id), before);
    assert.equal(await closeEvents(confirmed.id, 'confirmed'), 1);
    assert.equal(
      (
        await migration.query(
          "SELECT count(*)::int AS n FROM public.notifications n JOIN public.trade_events e ON e.id=n.domain_event_id WHERE e.trade_id=$1 AND e.event_type='cancelled'",
          [confirmed.id],
        )
      ).rows[0].n,
      members.length,
    );
  }

  // Read-time and rejected write-time expiry persist exactly one durable event.
  for (const access of ['detail', 'page', 'accept', 'revise', 'expire']) {
    const expired = await make();
    await migration.query(
      "UPDATE public.trades SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
      [expired.id],
    );
    if (access === 'detail')
      assert.equal((await detail(expired.id)).status, 'expired');
    if (access === 'page')
      await request(app)
        .get('/api/v1/trades/mine')
        .set(auth(alice))
        .expect(200);
    if (access === 'accept') {
      const result = await accept(expired.id).expect(409);
      assert.equal(result.body.error.code, 'PROPOSAL_EXPIRED');
    }
    if (access === 'revise')
      await request(app)
        .put(`/api/v1/trades/${expired.id}`)
        .set(auth(alice))
        .send({ ...expired.terms, expectedVersion: 1 })
        .expect(409);
    if (access === 'expire') await transition(expired.id, 'expire').expect(200);
    assert.equal(await status(expired.id), 'expired');
    await detail(expired.id);
    assert.equal(await closeEvents(expired.id, 'expired'), 1);
    assert.equal(await count('trade_acceptances', expired.id), 0);
    assert.equal(await active(expired.id), 0);
  }
  const noAutoRelease = await make([alice, bob], null, 1600);
  await accept(noAutoRelease.id).expect(200);
  await accept(noAutoRelease.id, bob).expect(200);
  await delay(1800);
  assert.equal((await detail(noAutoRelease.id)).status, 'confirmed');
  assert.equal(await active(noAutoRelease.id), 2);

  // Whichever final consent/cancellation wins the boundary, cancelled items have no reservations.
  for (let iteration = 0; iteration < 6; iteration++) {
    const race = await make();
    await accept(race.id).expect(200);
    const outcomes = await Promise.all([
      accept(race.id, bob),
      transition(race.id),
    ]);
    assert.equal(outcomes[1].status, 200);
    assert.ok([200, 409].includes(outcomes[0].status));
    await released(race);
  }

  // Any participant's immutable receipt or reported handover blocks release.
  for (const type of [
    'receipt_acknowledged',
    'handover_reported',
    'disputed',
  ]) {
    const handed = await confirm();
    await evidence(runtime, handed.id, type);
    await transition(handed.id).expect(409);
    assert.equal(await status(handed.id), 'confirmed');
    assert.equal(await active(handed.id), 2);
    assert.equal(await closeEvents(handed.id, 'cancelled'), 0);
    await assert.rejects(
      runtime.query(
        'UPDATE public.trade_events SET created_at=now() WHERE trade_id=$1',
        [handed.id],
      ),
    );
  }
  const disputed = await confirm();
  await migration.query(
    "UPDATE public.trades SET status='disputed' WHERE id=$1",
    [disputed.id],
  );
  await transition(disputed.id).expect(409);
  assert.equal(await active(disputed.id), 2);

  // Real concurrent evidence inserts acquire the same boundary through the DB guard.
  for (const first of ['evidence', 'cancel']) {
    const race = await confirm();
    const locker = await runtime.connect();
    try {
      await locker.query('BEGIN');
      await locker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('proposal-terms',0))",
      );
      if (first === 'evidence') {
        await evidence(locker, race.id, 'receipt_acknowledged');
        const pending = transition(race.id).then((r) => r);
        await delay(150);
        await locker.query('COMMIT');
        assert.equal((await pending).status, 409);
        assert.equal(await active(race.id), 2);
      } else {
        // Queue cancellation first, then the independent evidence writer.
        const pending = transition(race.id).then((r) => r);
        await delay(150);
        await locker.query('COMMIT');
        await pending;
        await assert.rejects(
          evidence(runtime, race.id, 'handover_reported'),
          (e) => e.code === '23514',
        );
        await released(race);
      }
    } finally {
      await locker.query('ROLLBACK');
      locker.release();
    }
  }

  for (let iteration = 0; iteration < 6; iteration++) {
    const race = await confirm();
    const [cancelled, recorded] = await Promise.all([
      transition(race.id),
      evidence(runtime, race.id, 'handover_reported').then(
        () => true,
        (error) => {
          assert.equal(error.code, '23514');
          return false;
        },
      ),
    ]);
    if (recorded) {
      assert.equal(cancelled.status, 409);
      assert.equal(await status(race.id), 'confirmed');
      assert.equal(await active(race.id), 2);
    } else {
      assert.equal(cancelled.status, 200);
      await released(race);
    }
  }

  const rollback = await confirm();
  await migration.query(`CREATE FUNCTION public.synthetic_cancel_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_type='trade_status' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
  await migration.query(
    'CREATE TRIGGER synthetic_cancel_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_cancel_failure()',
  );
  await transition(rollback.id).expect(500);
  assert.equal(await status(rollback.id), 'confirmed');
  assert.equal(await active(rollback.id), 2);
  assert.equal(await closeEvents(rollback.id, 'cancelled'), 0);
  await migration.query(
    'DROP TRIGGER synthetic_cancel_failure ON public.notifications',
  );
  await migration.query('DROP FUNCTION public.synthetic_cancel_failure()');
  await transition(rollback.id).expect(200);
  await released(rollback);
  const replacement = await make(
    [alice, bob],
    rollback.terms.transfers[0].listingId,
  );
  await accept(replacement.id).expect(200);
  await accept(replacement.id, bob).expect(200);
  assert.equal(await active(replacement.id), 2);
  await transition(rollback.id).expect(200);
  assert.equal(await active(replacement.id), 2);

  assert.equal(
    (
      await migration.query(
        "SELECT has_column_privilege('swapcircle_runtime','public.item_reservations','released_at','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    true,
  );
  await assert.rejects(
    runtime.query(
      'UPDATE public.item_reservations SET listing_id=listing_id WHERE false',
    ),
    (e) => e.code === '42501',
  );
  for (const user of [alice, outsider]) {
    assert.ok((await user.client.from('trade_events').insert({})).error);
    assert.ok(
      (
        await user.client
          .from('item_reservations')
          .update({ released_at: new Date().toISOString() })
          .eq('trade_id', noAutoRelease.id)
      ).error,
    );
  }
  console.log(
    'Trade lifecycle: authorized terminal transitions, durable expiry, atomic release/retries/rollback, confirmation and evidence serialization passed.',
  );
} finally {
  await migration.query(
    'DROP TRIGGER IF EXISTS synthetic_cancel_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION IF EXISTS public.synthetic_cancel_failure()',
  );
  await new Promise((resolve, reject) =>
    app.close((error) => (error ? reject(error) : resolve())),
  );
  await fixture.cleanup();
}
