// Real guarded synthetic PostgreSQL, runtime role and verified local Auth tokens.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
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
  allowance: 500,
  windowSeconds: 3600,
  burstMax: 1000,
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
const receipt = (
  id,
  user = alice,
  key = randomUUID(),
  extra = {},
  targetApp = app,
) =>
  request(targetApp)
    .post(`/api/v1/trades/${id}/receipt`)
    .set(auth(user))
    .send({ operationKey: key, expectedVersion: 1, ...extra });
const problem = (
  id,
  user = bob,
  key = randomUUID(),
  extra = {},
  targetApp = app,
) =>
  request(targetApp)
    .post(`/api/v1/trades/${id}/problem`)
    .set(auth(user))
    .send({
      operationKey: key,
      expectedVersion: 1,
      kind: 'problem',
      reason: 'Synthetic private evidence',
      ...extra,
    });
const notifications = async (id, kind) =>
  (
    await migration.query(
      `SELECT n.* FROM public.notifications n JOIN public.trade_events e ON e.id=n.domain_event_id
   WHERE e.trade_id=$1 AND e.event_type=$2`,
      [id, kind],
    )
  ).rows;
const availability = async (id) =>
  (await detail(id)).items.map((i) => i.currentAvailability);
const assertProtected = async (
  id,
  expected = 'disputed',
  itemState = 'disputed',
) => {
  assert.equal(await status(id), expected);
  assert.equal(await active(id), 2);
  assert.deepEqual(await availability(id), [itemState, itemState]);
  await transition(id).expect(409);
  await accept(id).expect(expected === 'confirmed' ? 200 : 409);
};
try {
  for (const user of fixture.users)
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  const proposed = await make();
  for (const action of ['receipt', 'problem']) {
    const body = {
      operationKey: randomUUID(),
      expectedVersion: 1,
      ...(action === 'problem' ? { kind: 'problem', reason: 'synthetic' } : {}),
    };
    await request(app)
      .post(`/api/v1/trades/${proposed.id}/${action}`)
      .send(body)
      .expect(401);
    await request(app)
      .post(`/api/v1/trades/${proposed.id}/${action}`)
      .set(auth(outsider))
      .send(body)
      .expect(404);
    await request(app)
      .post(`/api/v1/trades/${proposed.id}/${action}`)
      .set(auth(alice))
      .send({ ...body, actorId: bob.id })
      .expect(400);
    await request(app)
      .post(`/api/v1/trades/${proposed.id}/${action}`)
      .set(auth(bob))
      .send(body)
      .expect(409);
  }
  await receipt(proposed.id, alice, randomUUID(), {
    expectedVersion: 2,
  }).expect(409);
  await problem(proposed.id, bob, randomUUID(), { reason: '' }).expect(400);
  await problem(proposed.id, bob, randomUUID(), {
    reason: 'x'.repeat(2001),
  }).expect(400);
  const group = await make([alice, bob, carol]);
  await receipt(group.id, carol).expect(409);
  const revisedTransfers = group.terms.transfers
    .slice(0, 2)
    .map((item, index) => ({
      ...item,
      recipientId: [bob.id, alice.id][index],
    }));
  await request(app)
    .put(`/api/v1/trades/${group.id}`)
    .set(auth(alice))
    .send({
      ...group.terms,
      participantIds: [alice.id, bob.id],
      transfers: revisedTransfers,
      expectedVersion: 1,
    })
    .expect(200);
  await receipt(group.id, carol, randomUUID(), { expectedVersion: 2 }).expect(
    404,
  );
  await problem(group.id, carol, randomUUID(), { expectedVersion: 2 }).expect(
    404,
  );
  const restricted = await confirm();
  await migration.query(
    "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'synthetic')",
    [bob.id],
  );
  await receipt(restricted.id, bob).expect(403);
  await problem(restricted.id).expect(403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );
  assert.equal(await count('trade_outcome_operations', restricted.id), 0);

  // Direct and group completion requires exactly the frozen participant set.
  for (const members of [
    [alice, bob],
    [alice, bob, carol],
  ]) {
    const trade = await confirm(members);
    const key = randomUUID();
    const results = await Promise.all([
      receipt(trade.id, alice, key),
      receipt(trade.id, alice, key),
      receipt(trade.id, alice),
    ]);
    assert.ok(
      results.every((r) => r.status === 200 && r.body.status === 'confirmed'),
    );
    assert.equal(await closeEvents(trade.id, 'receipt_acknowledged'), 1);
    assert.equal(await active(trade.id), members.length);
    assert.equal(await status(trade.id), 'confirmed');
    await transition(trade.id).expect(409);
    const conflict = await problem(trade.id, alice, key).expect(409);
    assert.equal(conflict.body.error.code, 'OPERATION_CONFLICT');
    for (const member of members.slice(1))
      await receipt(trade.id, member).expect(200);
    assert.equal(await status(trade.id), 'completed');
    assert.equal(
      await closeEvents(trade.id, 'receipt_acknowledged'),
      members.length,
    );
    assert.equal(await closeEvents(trade.id, 'completed'), 1);
    assert.equal(
      (await notifications(trade.id, 'completed')).length,
      members.length,
    );
    assert.ok((await availability(trade.id)).every((a) => a === 'exchanged'));
    assert.equal(
      (await receipt(trade.id, alice, key).expect(200)).body.status,
      'completed',
    );
    await receipt(trade.id, bob).expect(200);
    assert.equal(await closeEvents(trade.id, 'completed'), 1);
    await transition(trade.id).expect(409);
    await problem(trade.id).expect(409);
    const item = trade.terms.transfers[0].listingId;
    await request(app)
      .post(`/api/v1/listings/${item}/withdraw`)
      .set(auth(alice))
      .send({ revision: 1 })
      .expect(409);
    await assert.rejects(
      runtime.query(
        "UPDATE public.listings SET availability='available' WHERE id=$1",
        [item],
      ),
      (e) => e.code === '23514',
    );
    await request(app)
      .post('/api/v1/trades')
      .set(auth(alice))
      .send({ ...trade.terms, operationKey: randomUUID() })
      .expect(409);
    await assert.rejects(
      runtime.query(
        'UPDATE public.trade_outcome_operations SET reason=reason WHERE trade_id=$1',
        [trade.id],
      ),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      migration.query(
        'DELETE FROM public.trade_outcome_operations WHERE trade_id=$1',
        [trade.id],
      ),
      (e) => e.code === 'P0001',
    );
    const another = await confirm();
    assert.equal(
      (await receipt(another.id, alice, key).expect(409)).body.error.code,
      'OPERATION_CONFLICT',
    );
  }
  // Group-chat consent remains independent through handover: a left member and
  // a pending invitee retain frozen trade permissions, but no group history/send.
  for (const outcome of ['receipt', 'problem']) {
    const trade = await make([alice, bob, carol]);
    const groupId = (await detail(trade.id)).groupConversationId;
    const savedMessage = (
      await request(app)
        .post('/api/v1/conversations/messages')
        .set(auth(alice))
        .send({
          conversation_id: groupId,
          client_message_id: randomUUID(),
          body: 'Synthetic private group history',
        })
        .expect(200)
    ).body;
    const ownerHistory = await alice.client
      .from('messages')
      .select('id')
      .eq('conversation_id', groupId)
      .retry(false);
    assert.equal(ownerHistory.error, null);
    assert.deepEqual(
      ownerHistory.data.map((row) => row.id),
      [savedMessage.id],
    );

    await request(app)
      .put(`/api/v1/conversations/${groupId}/invitation/accept`)
      .set(auth(bob))
      .expect(200);
    await request(app)
      .put(`/api/v1/conversations/${groupId}/leave`)
      .set(auth(bob))
      .expect(200);
    for (const member of [alice, bob, carol])
      await accept(trade.id, member).expect(200);
    await receipt(trade.id, bob).expect(200);
    if (outcome === 'receipt') {
      await receipt(trade.id, carol).expect(200);
      await receipt(trade.id, alice).expect(200);
      assert.equal(await status(trade.id), 'completed');
    } else {
      await problem(trade.id, carol).expect(200);
      assert.equal(await status(trade.id), 'disputed');
    }
    for (const member of [bob, carol, outsider]) {
      const history = await member.client
        .from('messages')
        .select('*')
        .eq('conversation_id', groupId)
        .retry(false);
      assert.equal(history.error, null);
      assert.deepEqual(history.data, []);
      await request(app)
        .post('/api/v1/conversations/messages')
        .set(auth(member))
        .send({
          conversation_id: groupId,
          client_message_id: randomUUID(),
          body: 'Synthetic forbidden send',
        })
        .expect(403);
      const inbox = await member.client
        .from('notifications')
        .select('*')
        .eq('resource_id', trade.id)
        .retry(false);
      assert.equal(inbox.error, null);
      assert.ok(inbox.data.every((row) => row.recipient_id === member.id));
      assert.ok(
        !JSON.stringify(inbox.data).includes('Synthetic private evidence'),
      );
      if (member === outsider) assert.deepEqual(inbox.data, []);
      else assert.ok(inbox.data.length > 0);
    }
    assert.deepEqual(
      (
        await migration.query(
          'SELECT status FROM public.conversation_members WHERE conversation_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY status',
          [groupId, [bob.id, carol.id]],
        )
      ).rows.map((row) => row.status),
      ['left', 'pending'],
    );
    assert.equal(await active(trade.id), 3);
  }

  // Recorded private problems and partial handovers preserve evidence and reservations.
  for (const kind of ['problem', 'partial_handover']) {
    const trade = await confirm();
    const key = randomUUID();
    await receipt(trade.id).expect(200);
    const results = await Promise.all([
      problem(trade.id, bob, key, { kind }),
      problem(trade.id, bob, key, { kind }),
    ]);
    assert.ok(
      results.every((r) => r.status === 200 && r.body.status === 'disputed'),
    );
    assert.equal(await closeEvents(trade.id, 'disputed'), 1);
    assert.equal(
      await closeEvents(trade.id, 'handover_reported'),
      kind === 'partial_handover' ? 1 : 0,
    );
    assert.equal((await notifications(trade.id, 'disputed')).length, 2);
    const before = await count('trade_outcome_operations', trade.id);
    assert.equal(
      (
        await problem(trade.id, bob, key, {
          kind,
          reason: 'Different evidence',
        }).expect(409)
      ).body.error.code,
      'OPERATION_CONFLICT',
    );
    assert.equal(await count('trade_outcome_operations', trade.id), before);
    await receipt(trade.id, bob).expect(200);
    await assertProtected(trade.id);
    assert.equal(await closeEvents(trade.id, 'completed'), 0);
    const saved = await migration.query(
      'SELECT reason FROM public.trade_outcome_operations WHERE trade_id=$1 AND kind=$2',
      [trade.id, kind],
    );
    assert.equal(saved.rows[0].reason, 'Synthetic private evidence');
    for (const member of [alice, bob]) {
      const visible = await request(app)
        .get(`/api/v1/trades/${trade.id}`)
        .set(auth(member))
        .expect(200);
      assert.ok(
        !JSON.stringify(visible.body).includes('Synthetic private evidence'),
      );
      const inbox = await member.client
        .from('notifications')
        .select('*')
        .eq('resource_id', trade.id);
      assert.equal(inbox.error, null);
      assert.ok(
        !JSON.stringify(inbox.data).includes('Synthetic private evidence'),
      );
    }
    for (const member of [alice, bob, outsider]) {
      assert.ok(
        (
          await member.client
            .from('trade_outcome_operations')
            .select('*')
            .eq('trade_id', trade.id)
        ).error,
      );
      assert.ok(
        (
          await member.client.from('trade_outcome_operations').insert({
            actor_id: member.id,
            operation_key: randomUUID(),
            trade_id: trade.id,
            version: 1,
            kind: 'receipt',
          })
        ).error,
      );
      assert.ok((await member.client.from('trade_events').insert({})).error);
      assert.ok(
        (
          await member.client
            .from('item_reservations')
            .update({ released_at: new Date().toISOString() })
            .eq('trade_id', trade.id)
        ).error,
      );
    }
  }

  // Final acknowledgement cannot release after an earlier participant's receipt.
  for (let iteration = 0; iteration < 6; iteration++) {
    const trade = await confirm();
    await receipt(trade.id).expect(200);
    const [final, cancel] = await Promise.all([
      receipt(trade.id, bob),
      transition(trade.id),
    ]);
    assert.equal(final.status, 200);
    assert.equal(cancel.status, 409);
    await assertProtected(trade.id, 'completed', 'exchanged');
  }
  // Before first handover either cancellation wins, or protection commits atomically.
  for (const action of ['receipt', 'problem'])
    for (let iteration = 0; iteration < 4; iteration++) {
      const trade = await confirm();
      const [handover, cancel] = await Promise.all([
        action === 'receipt' ? receipt(trade.id) : problem(trade.id),
        transition(trade.id),
      ]);
      if (cancel.status === 200) {
        assert.equal(handover.status, 409);
        assert.equal(await status(trade.id), 'cancelled');
        assert.equal(await active(trade.id), 0);
        assert.equal(await count('trade_outcome_operations', trade.id), 0);
        assert.ok(
          (await availability(trade.id)).every((a) => a === 'available'),
        );
      } else {
        assert.equal(cancel.status, 409);
        assert.equal(handover.status, 200);
        await assertProtected(
          trade.id,
          action === 'receipt' ? 'confirmed' : 'disputed',
          action === 'receipt' ? 'reserved' : 'disputed',
        );
      }
    }
  // A queued problem wins the boundary before final receipt: no accidental completion.
  const handover = await confirm();
  await receipt(handover.id).expect(200);
  const locker = await runtime.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('proposal-terms',0))",
    );
    const reported = problem(handover.id, bob, randomUUID(), {
      kind: 'partial_handover',
    }).then((r) => r);
    for (let attempt = 0; ; attempt++) {
      const waiting = await migration.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='swapcircle_runtime' AND wait_event='advisory'",
      );
      if (waiting.rows[0].n >= 1) break;
      assert.ok(attempt < 100, 'Problem request must reach the trade boundary');
      await delay(20);
    }
    const final = receipt(handover.id, bob).then((r) => r);
    for (let attempt = 0; ; attempt++) {
      const waiting = await migration.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='swapcircle_runtime' AND wait_event='advisory'",
      );
      if (waiting.rows[0].n >= 2) break;
      assert.ok(attempt < 100, 'Final receipt must reach the trade boundary');
      await delay(20);
    }
    await locker.query('COMMIT');
    assert.equal((await reported).status, 200);
    assert.equal((await final).status, 200);
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
  }
  await assertProtected(handover.id);
  assert.equal(await closeEvents(handover.id, 'completed'), 0);

  // Notification failure rolls back operation key, receipt/evidence, listings and status.
  for (const action of ['receipt', 'problem']) {
    const trade = await confirm();
    if (action === 'receipt') await receipt(trade.id).expect(200);
    const key = randomUUID();
    const events = await count('trade_events', trade.id);
    const operations = await count('trade_outcome_operations', trade.id);
    await migration.query(
      `CREATE FUNCTION public.synthetic_outcome_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='trade_status' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`,
    );
    await migration.query(
      'CREATE TRIGGER synthetic_outcome_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_outcome_failure()',
    );
    const submit = (targetApp = app) =>
      action === 'receipt'
        ? receipt(trade.id, bob, key, {}, targetApp)
        : problem(trade.id, bob, key, { kind: 'partial_handover' }, targetApp);
    await submit().expect(500);
    assert.equal(await status(trade.id), 'confirmed');
    assert.equal(await active(trade.id), 2);
    assert.deepEqual(await availability(trade.id), ['reserved', 'reserved']);
    assert.equal(await count('trade_events', trade.id), events);
    assert.equal(await count('trade_outcome_operations', trade.id), operations);
    await migration.query(
      'DROP TRIGGER synthetic_outcome_failure ON public.notifications',
    );
    await migration.query('DROP FUNCTION public.synthetic_outcome_failure()');
    // Destroy the socket at response send, after the domain transaction commits.
    const lostResponse = createServer((req, res) => {
      res.end = () => {
        res.destroy();
        return res;
      };
      application(req, res);
    });
    lostResponse.listen(0, '127.0.0.1');
    await once(lostResponse, 'listening');
    try {
      await assert.rejects(
        submit(lostResponse),
        (error) => error.code === 'ECONNRESET',
      );
    } finally {
      await new Promise((resolve, reject) =>
        lostResponse.close((error) => (error ? reject(error) : resolve())),
      );
    }
    const recovered = await submit().expect(200);
    assert.equal(
      recovered.body.status,
      action === 'receipt' ? 'completed' : 'disputed',
    );
    assert.equal(
      await closeEvents(
        trade.id,
        action === 'receipt' ? 'completed' : 'disputed',
      ),
      1,
    );
    assert.equal(
      (
        await notifications(
          trade.id,
          action === 'receipt' ? 'completed' : 'disputed',
        )
      ).length,
      2,
    );
  }
  console.log(
    'Trade outcomes: authenticated per-participant receipts, unanimous atomic completion, private retry-safe disputes, left/pending group members retain trade outcomes with explicit chat/notification isolation, retained reservations, cancellation/handover concurrency, notification rollback and direct grants/RLS denial passed.',
  );
} finally {
  await migration.query(
    'DROP TRIGGER IF EXISTS synthetic_outcome_failure ON public.notifications',
  );
  await migration.query(
    'DROP FUNCTION IF EXISTS public.synthetic_outcome_failure()',
  );
  await new Promise((resolve, reject) =>
    app.close((error) => (error ? reject(error) : resolve())),
  );
  await fixture.cleanup();
}
