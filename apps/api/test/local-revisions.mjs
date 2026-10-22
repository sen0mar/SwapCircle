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
const failNotifications = async (enabled) => {
  if (enabled) {
    await migration.query(`CREATE FUNCTION public.synthetic_revision_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN IF true THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
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
    [bob.id, alice.id],
  );
  await revise(id, terms()).expect(403);
  await migration.query('DELETE FROM public.blocks WHERE blocker_id=$1', [
    bob.id,
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
  await failNotifications(true);
  await revise(id, terms([alice, bob], 3)).expect(500);
  await failNotifications(false);
  assert.equal((await detail(id)).currentVersion, 3);
  await revise(id, terms([alice, bob, carol], 3)).expect(400);
  const beforeReplacement = await detail(id);
  const replacementResponse = await revise(id, terms([alice, carol], 3)).expect(
    422,
  );
  assert.equal(replacementResponse.body.error.code, 'PARTICIPANTS_FIXED');
  assert.deepEqual(await detail(id), beforeReplacement);
  await assert.rejects(
    migration.query(
      'UPDATE public.trade_participants SET user_id=$3 WHERE trade_id=$1 AND user_id=$2',
      [id, bob.id, carol.id],
    ),
    { code: '23514' },
  );
  await assert.rejects(
    migration.query(
      'INSERT INTO public.trade_participants (trade_id,user_id) VALUES ($1,$2)',
      [id, carol.id],
    ),
    { code: '23514' },
  );
  // Competing listing and proposal edits serialize; both outcomes preserve fresh current snapshots.
  const before = (await detail(id)).currentVersion;
  await migration.query(
    'UPDATE public.trade_participants SET accepted_version=$2,accepted_at=now() WHERE trade_id=$1',
    [id, before],
  );
  const race = await Promise.all([
    revise(id, terms([alice, bob], before)),
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
  await revise(id, terms([alice, bob], before)).expect(409);
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
      'UPDATE public.trade_participants SET user_id=gen_random_uuid() WHERE trade_id=$1',
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
  const expired = await create();
  await migration.query(
    "UPDATE public.trades SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",
    [expired],
  );
  await revise(expired, terms(), bob).expect(409);
  console.info(
    'Local revision authorization, immutable history, stale races, listing coordination, fixed participants, frozen terms and rollback passed.',
  );
} catch (error) {
  console.error(error.message);
  throw error;
} finally {
  await failNotifications(false);
  await fixture.cleanup();
}
