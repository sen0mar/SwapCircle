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
const pristine = async (id, accepted = 0) => {
  assert.equal((await detail(id)).status, 'proposed');
  assert.equal(await count('item_reservations', id), 0);
  assert.equal(await count('trade_acceptances', id), accepted);
  assert.equal(
    await count('trade_events', id, "AND event_type='confirmed'"),
    0,
  );
  assert.equal(
    (
      await migration.query(
        "SELECT count(*)::int AS n FROM public.notifications WHERE resource_id=$1 AND event_type='trade_status'",
        [id],
      )
    ).rows[0].n,
    0,
  );
};
const confirmed = async (id, items, members, acceptedEvents = members) => {
  const saved = await detail(id);
  assert.equal(saved.status, 'confirmed');
  assert.ok(
    saved.participants.every((p) => p.acceptedVersion === saved.currentVersion),
  );
  assert.ok(
    saved.participants.every(
      (p) => p.invitationStatus === 'joined' && p.respondedAt !== null,
    ),
  );
  assert.equal(await count('item_reservations', id), items);
  assert.equal(
    await count('trade_events', id, "AND event_type='confirmed'"),
    1,
  );
  assert.equal(
    await count('trade_events', id, "AND event_type='accepted'"),
    acceptedEvents,
  );
  assert.equal(
    (
      await migration.query(
        "SELECT count(*)::int AS n FROM public.notifications WHERE resource_id=$1 AND event_type='trade_status'",
        [id],
      )
    ).rows[0].n,
    members,
  );
  assert.ok(
    saved.items.every((item) => item.currentAvailability === 'reserved'),
  );
};
const failure = async (enabled) => {
  if (enabled) {
    await migration.query(`CREATE FUNCTION public.synthetic_acceptance_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='trade_status' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await migration.query(
      'CREATE TRIGGER synthetic_acceptance_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.synthetic_acceptance_failure()',
    );
  } else {
    await migration.query(
      'DROP TRIGGER IF EXISTS synthetic_acceptance_failure ON public.notifications',
    );
    await migration.query(
      'DROP FUNCTION IF EXISTS public.synthetic_acceptance_failure()',
    );
  }
};
try {
  for (const user of fixture.users)
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);

  const direct = await make();
  await request(app)
    .post(`/api/v1/trades/${direct.id}/accept`)
    .send({ expectedVersion: 1, operationKey: randomUUID() })
    .expect(401);
  await accept(direct.id, outsider).expect(404);
  await accept(direct.id, alice, randomUUID(), 1, { actorId: bob.id }).expect(
    400,
  );
  await accept(direct.id, alice, randomUUID(), 0).expect(400);
  await accept(direct.id, alice, randomUUID(), 2).expect(409);
  await pristine(direct.id);
  const key = randomUUID();
  const clicks = await Promise.all([
    accept(direct.id, alice, key),
    accept(direct.id, alice, key),
    accept(direct.id),
  ]);
  assert.ok(clicks.every((r) => r.status === 200));
  assert.deepEqual(clicks[0].body, clicks[1].body);
  assert.equal(await count('trade_acceptances', direct.id), 1);
  assert.equal(
    await count('trade_events', direct.id, "AND event_type='accepted'"),
    1,
  );
  await pristine(direct.id, 1);
  await accept(direct.id, alice, key, 2).expect(409);
  const finalKey = randomUUID();
  const finals = await Promise.all([
    accept(direct.id, bob, finalKey),
    accept(direct.id, bob, finalKey),
    accept(direct.id, bob),
  ]);
  assert.ok(
    finals.every((r) => r.status === 200 && r.body.status === 'confirmed'),
  );
  await confirmed(direct.id, 2, 2);
  assert.deepEqual(
    (await accept(direct.id, alice, key).expect(200)).body,
    clicks[0].body,
  );
  await request(app)
    .put(`/api/v1/trades/${direct.id}`)
    .set(auth(alice))
    .send({ ...direct.terms, expectedVersion: 1 })
    .expect(409);
  await assert.rejects(
    migration.query(
      'UPDATE public.trade_acceptances SET accepted_at=now() WHERE trade_id=$1',
      [direct.id],
    ),
  );
  await assert.rejects(
    migration.query(
      "UPDATE public.trade_items SET title_snapshot='Forged' WHERE trade_id=$1",
      [direct.id],
    ),
  );
  await assert.rejects(
    migration.query(
      'INSERT INTO public.item_reservations (trade_id,listing_id) VALUES ($1,$2)',
      [direct.id, direct.terms.transfers[0].listingId],
    ),
    (e) => e.code === '23505',
  );

  await migration.query(
    'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
    [bob.id, alice.id],
  );
  await accept(direct.id, alice).expect(403);
  assert.deepEqual(
    (await accept(direct.id, alice, key).expect(200)).body,
    clicks[0].body,
  );
  await migration.query('DELETE FROM public.blocks WHERE blocker_id=$1', [
    bob.id,
  ]);
  await migration.query(
    "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'synthetic')",
    [bob.id],
  );
  await accept(direct.id, alice).expect(403);
  await migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );

  // Competing direct/group proposals share one listing. Every other item must
  // remain available on the losing proposal; final consent itself rolls back.
  for (const groups of [false, true, 'both']) {
    const first = await make(groups ? [alice, bob, carol] : [alice, bob]);
    const second = await make(
      groups === 'both' ? [alice, bob, carol] : [alice, bob],
      first.terms.transfers[0].listingId,
    );
    await accept(first.id).expect(200);
    if (groups) await accept(first.id, carol).expect(200);
    await accept(second.id).expect(200);
    if (groups === 'both') await accept(second.id, carol).expect(200);
    const race = await Promise.all([
      accept(first.id, bob),
      accept(second.id, bob),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const winner = race[0].status === 200 ? first : second;
    const loser = winner === first ? second : first;
    await confirmed(
      winner.id,
      winner.terms.transfers.length,
      winner.terms.participantIds.length,
    );
    await pristine(loser.id, loser.terms.participantIds.length - 1);
    for (const transfer of loser.terms.transfers.slice(1))
      assert.equal(
        (
          await migration.query(
            'SELECT availability FROM public.listings WHERE id=$1',
            [transfer.listingId],
          )
        ).rows[0].availability,
        'available',
      );
    await accept(loser.id, bob).expect(409);
  }

  const rollback = await make([alice, bob, carol]);
  const chatId = (await detail(rollback.id)).groupConversationId;
  await accept(rollback.id).expect(200);
  await accept(rollback.id, bob).expect(200);
  const membershipBefore = (
    await migration.query(
      'SELECT user_id,status,active FROM public.conversation_members WHERE conversation_id=$1 ORDER BY user_id',
      [chatId],
    )
  ).rows;
  const retryKey = randomUUID();
  await failure(true);
  await accept(rollback.id, carol, retryKey).expect(500);
  await failure(false);
  await pristine(rollback.id, 2);
  assert.equal(
    (
      await migration.query(
        'SELECT count(*)::int AS n FROM public.trade_acceptance_operations WHERE actor_id=$1 AND operation_key=$2',
        [carol.id, retryKey],
      )
    ).rows[0].n,
    0,
  );
  for (const transfer of rollback.terms.transfers)
    assert.equal(
      (
        await migration.query(
          'SELECT availability FROM public.listings WHERE id=$1',
          [transfer.listingId],
        )
      ).rows[0].availability,
      'available',
    );
  await accept(rollback.id, carol, retryKey).expect(200);
  await confirmed(rollback.id, 3, 3);
  assert.deepEqual(
    (
      await migration.query(
        'SELECT user_id,status,active FROM public.conversation_members WHERE conversation_id=$1 ORDER BY user_id',
        [chatId],
      )
    ).rows,
    membershipBefore,
  );

  // Chat consent, decline and leave do not create trade consent; acceptance also
  // remains possible for an active trade participant with declined/left chat.
  const chat = await make([alice, bob, carol]);
  const conversation = (await detail(chat.id)).groupConversationId;
  await request(app)
    .put(`/api/v1/conversations/${conversation}/invitation/accept`)
    .set(auth(bob))
    .expect(200);
  await request(app)
    .put(`/api/v1/conversations/${conversation}/leave`)
    .set(auth(bob))
    .expect(200);
  await request(app)
    .put(`/api/v1/conversations/${conversation}/invitation/decline`)
    .set(auth(carol))
    .expect(200);
  await pristine(chat.id);
  await accept(chat.id).expect(200);
  await accept(chat.id, bob).expect(200);
  await accept(chat.id, carol).expect(200);
  await confirmed(chat.id, 3, 3);
  assert.deepEqual(
    (
      await migration.query(
        'SELECT status FROM public.conversation_members WHERE conversation_id=$1 AND user_id=ANY($2::uuid[]) ORDER BY status',
        [conversation, [bob.id, carol.id]],
      )
    ).rows.map((r) => r.status),
    ['declined', 'left'],
  );

  for (const kind of [
    'expired',
    'blocked',
    'restricted',
    'unavailable',
    'snapshot',
    'membership',
    'removed',
  ]) {
    const proposal = await make(
      kind === 'removed' ? [alice, bob, carol] : [alice, bob],
    );
    if (kind === 'expired')
      await migration.query(
        "UPDATE public.trades SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",
        [proposal.id],
      );
    if (kind === 'blocked')
      await migration.query(
        'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
        [bob.id, alice.id],
      );
    if (kind === 'restricted')
      await migration.query(
        "INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,'synthetic')",
        [bob.id],
      );
    if (kind === 'unavailable')
      await migration.query(
        "UPDATE public.listings SET availability='withdrawn' WHERE id=$1",
        [proposal.terms.transfers[1].listingId],
      );
    if (kind === 'snapshot')
      await migration.query(
        "UPDATE public.listings SET title='Changed without revision' WHERE id=$1",
        [proposal.terms.transfers[0].listingId],
      );
    if (kind === 'membership')
      await migration.query(
        'UPDATE public.trade_participants SET active=false WHERE trade_id=$1 AND user_id=$2',
        [proposal.id, bob.id],
      );
    if (kind === 'removed') {
      await request(app)
        .put(`/api/v1/trades/${proposal.id}`)
        .set(auth(alice))
        .send({
          ...proposal.terms,
          expectedVersion: 1,
          participantIds: [alice.id, bob.id],
          transfers: proposal.terms.transfers.slice(0, 2).map((t, i) => ({
            ...t,
            recipientId: i === 0 ? bob.id : alice.id,
          })),
        })
        .expect(200);
      await accept(proposal.id, carol).expect(404);
    } else
      await accept(proposal.id).expect(
        ['blocked', 'restricted'].includes(kind) ? 403 : 409,
      );
    assert.equal(await count('trade_acceptances', proposal.id), 0);
    assert.equal(await count('item_reservations', proposal.id), 0);
    if (kind === 'blocked')
      await migration.query('DELETE FROM public.blocks WHERE blocker_id=$1', [
        bob.id,
      ]);
    if (kind === 'restricted')
      await migration.query(
        'DELETE FROM public.account_restrictions WHERE user_id=$1',
        [bob.id],
      );
  }

  // Both requests contend for the shared boundary. Whichever wins, version 2
  // cannot inherit version 1 consent; the old acceptance remains immutable.
  const revision = await make();
  const concurrentRevision = await Promise.all([
    accept(revision.id),
    request(app)
      .put(`/api/v1/trades/${revision.id}`)
      .set(auth(bob))
      .send({ ...revision.terms, expectedVersion: 1 }),
  ]);
  assert.equal(concurrentRevision[1].status, 200);
  assert.ok([200, 409].includes(concurrentRevision[0].status));
  assert.ok(
    (await detail(revision.id)).participants.every(
      (p) => p.acceptedVersion === null,
    ),
  );
  await accept(revision.id, bob, randomUUID(), 1).expect(409);
  await accept(revision.id, alice, randomUUID(), 2).expect(200);
  await accept(revision.id, bob, randomUUID(), 2).expect(200);
  await confirmed(
    revision.id,
    2,
    2,
    concurrentRevision[0].status === 200 ? 3 : 2,
  );

  const edited = await make();
  const listing = edited.terms.transfers[0].listingId;
  const changes = await Promise.all([
    accept(edited.id),
    request(app).put(`/api/v1/listings/${listing}`).set(auth(alice)).send({
      revision: 1,
      title: 'Changed listing',
      description: 'New synthetic terms',
      condition: 'fair',
    }),
  ]);
  assert.equal(changes[1].status, 200);
  assert.ok([200, 409].includes(changes[0].status));
  assert.equal((await detail(edited.id)).currentVersion, 2);
  assert.ok(
    (await detail(edited.id)).participants.every(
      (p) => p.acceptedVersion === null,
    ),
  );
  await accept(edited.id, bob, randomUUID(), 1).expect(409);

  const together = await make([alice, bob, carol]);
  const simultaneousActors = await Promise.all([
    accept(together.id),
    accept(together.id, bob),
    accept(together.id, carol),
  ]);
  assert.ok(simultaneousActors.every((r) => r.status === 200));
  assert.equal(
    simultaneousActors.filter((r) => r.body.status === 'confirmed').length,
    1,
  );
  await confirmed(together.id, 3, 3);

  const finalRevision = await make();
  await accept(finalRevision.id).expect(200);
  const finalRevisionRace = await Promise.all([
    accept(finalRevision.id, bob),
    request(app)
      .put(`/api/v1/trades/${finalRevision.id}`)
      .set(auth(alice))
      .send({ ...finalRevision.terms, expectedVersion: 1 }),
  ]);
  assert.deepEqual(finalRevisionRace.map((r) => r.status).sort(), [200, 409]);
  if (finalRevisionRace[0].status === 200)
    await confirmed(finalRevision.id, 2, 2);
  else {
    await pristine(finalRevision.id, 1);
    assert.ok(
      (await detail(finalRevision.id)).participants.every(
        (p) => p.acceptedVersion === null,
      ),
    );
  }

  // Expiry is rechecked with the database clock after an actual row-lock wait.
  const expiring = await make([alice, bob], null, 1200);
  const locker = await migration.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(
      'SELECT id FROM public.listings WHERE id=$1 FOR UPDATE',
      [expiring.terms.transfers[0].listingId],
    );
    const pending = accept(expiring.id).then((r) => r);
    await delay(200);
    assert.ok(
      (
        await locker.query(
          "SELECT 1 FROM pg_stat_activity WHERE usename='swapcircle_runtime' AND wait_event_type='Lock' AND query LIKE '%ORDER BY id FOR UPDATE%'",
        )
      ).rowCount > 0,
    );
    await delay(1300);
    await locker.query('COMMIT');
    const expired = await pending;
    assert.equal(expired.status, 409);
    assert.equal(expired.body.error.code, 'PROPOSAL_EXPIRED');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
  }

  assert.equal(await count('trade_acceptances', expiring.id), 0);
  assert.equal(await count('item_reservations', expiring.id), 0);

  const other = await make();
  await accept(other.id, alice, key).expect(409);
  for (const table of [
    'trade_acceptances',
    'trade_acceptance_operations',
    'item_reservations',
  ]) {
    const denied = await alice.client.from(table).select('*');
    assert.ok(denied.error);
    const write = await alice.client.from(table).insert({});
    assert.ok(write.error);
    await assert.rejects(
      runtime.query(`DELETE FROM public.${table} WHERE false`),
      (e) => e.code === '42501',
    );
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal(
        (
          await migration.query(
            "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS access",
            [role, `public.${table}`],
          )
        ).rows[0].access,
        false,
      );
  }
  // RLS remains a separate defense even after an accidental browser grant.
  const rlsClient = await migration.connect();
  try {
    await rlsClient.query('BEGIN');
    await rlsClient.query(
      'GRANT SELECT,INSERT,UPDATE,DELETE ON public.trade_acceptances,public.trade_acceptance_operations,public.item_reservations TO authenticated',
    );
    await rlsClient.query('SET LOCAL ROLE authenticated');
    await rlsClient.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true)",
      [alice.id],
    );
    for (const table of [
      'trade_acceptances',
      'trade_acceptance_operations',
      'item_reservations',
    ]) {
      assert.equal(
        (await rlsClient.query(`SELECT * FROM public.${table}`)).rowCount,
        0,
      );
      assert.equal(
        (await rlsClient.query(`DELETE FROM public.${table}`)).rowCount,
        0,
      );
    }
    for (const [sql, values] of [
      [
        'INSERT INTO public.trade_acceptances (trade_id,version,actor_id) VALUES ($1,1,$2)',
        [other.id, bob.id],
      ],
      [
        "INSERT INTO public.trade_acceptance_operations (trade_id,version,actor_id,operation_key,result_status) VALUES ($1,1,$2,$3,'confirmed')",
        [direct.id, bob.id, randomUUID()],
      ],
      [
        'INSERT INTO public.item_reservations (trade_id,listing_id) VALUES ($1,$2)',
        [other.id, other.terms.transfers[0].listingId],
      ],
    ]) {
      await rlsClient.query('SAVEPOINT browser_write');
      await assert.rejects(
        rlsClient.query(sql, values),
        (e) => e.code === '42501',
      );
      await rlsClient.query('ROLLBACK TO SAVEPOINT browser_write');
    }
  } finally {
    await rlsClient.query('ROLLBACK');
    rlsClient.release();
  }

  // Independently exercise the unique partial index with competing runtime
  // transactions, even if a caller fails to honor the proposal boundary.
  const indexFirst = await make();
  const indexSecond = await make(
    [alice, bob],
    indexFirst.terms.transfers[0].listingId,
  );
  const indexListing = indexFirst.terms.transfers[0].listingId;
  const one = await runtime.connect();
  const two = await runtime.connect();
  try {
    await one.query('BEGIN');
    await two.query('BEGIN');
    await one.query(
      'INSERT INTO public.item_reservations (trade_id,listing_id) VALUES ($1,$2)',
      [indexFirst.id, indexListing],
    );
    let settled = false;
    const competingInsert = two
      .query(
        'INSERT INTO public.item_reservations (trade_id,listing_id) VALUES ($1,$2)',
        [indexSecond.id, indexListing],
      )
      .then(
        () => ({ code: 'unexpected success' }),
        (error) => error,
      )
      .finally(() => {
        settled = true;
      });
    await delay(100);
    assert.equal(settled, false);
    await one.query('COMMIT');
    assert.equal((await competingInsert).code, '23505');
    await two.query('ROLLBACK');
    assert.equal(await count('item_reservations', indexFirst.id), 1);
    assert.equal(await count('item_reservations', indexSecond.id), 0);
    // The reservation check also rejects inconsistent available listing flags.
    await accept(indexSecond.id).expect(409);
  } finally {
    await one.query('ROLLBACK');
    await two.query('ROLLBACK');
    one.release();
    two.release();
  }

  const limited = fixture.makeApp({
    allowance: 1,
    windowSeconds: 3600,
    burstMax: 240,
    burstWindowMs: 60000,
  });
  for (const proposal of [other, together]) {
    await migration.query(
      "DELETE FROM public.action_quotas WHERE user_id=$1 AND action='trade'",
      [alice.id],
    );
    const quotaKey = randomUUID();
    const receipt = await accept(
      proposal.id,
      alice,
      quotaKey,
      1,
      {},
      limited,
    ).expect(200);
    assert.deepEqual(
      (await accept(proposal.id, alice, quotaKey, 1, {}, limited).expect(200))
        .body,
      receipt.body,
    );
    await accept(proposal.id, alice, randomUUID(), 1, {}, limited).expect(429);
    assert.equal(
      (
        await migration.query(
          "SELECT used FROM public.action_quotas WHERE user_id=$1 AND action='trade'",
          [alice.id],
        )
      ).rows[0].used,
      1,
    );
    assert.equal(
      (
        await migration.query(
          'SELECT count(*)::int AS n FROM public.trade_acceptance_operations WHERE actor_id=$1 AND operation_key=$2',
          [alice.id, quotaKey],
        )
      ).rows[0].n,
      1,
    );
  }

  console.log(
    'Atomic acceptance: direct/group races, exact consent, retries, rollback, snapshots, chat independence, immutable history and RLS passed.',
  );
} finally {
  await failure(false);
  await new Promise((resolve, reject) =>
    app.close((error) => (error ? reject(error) : resolve())),
  );
  await fixture.cleanup();
}
