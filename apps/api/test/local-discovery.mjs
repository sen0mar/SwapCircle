import assert from 'node:assert/strict';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import request from 'supertest';
import { listingPageSchema, memberPageSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const {
  app,
  users: [alice, bob, carol, dan],
  migration,
} = fixture;
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const marker = `catalog${randomUUID().replaceAll('-', '')}`;
const search = async (query = {}) =>
  (
    await request(app)
      .get('/api/v1/listings')
      .query({ q: marker, ...query })
      .expect(200)
  ).body;

try {
  const interests = (
    await request(app).get('/api/v1/interests').expect(200)
  ).body.slice(0, 3);
  const interestIds = interests.map((interest) => interest.id);
  for (const [user, ids, displayName] of [
    [alice, interestIds, 'Local Alice'],
    [bob, interestIds.slice(0, 2), 'Local Bob'],
    [carol, interestIds.slice(0, 1), 'Local Carol'],
    [dan, [], 'Local Dan'],
  ]) {
    await request(app)
      .put('/api/v1/profiles/me')
      .set(auth(user))
      .send({
        displayName,
        biography: '<b>Public biography</b>',
        approximateLocation: 'Paris area',
        interestIds: ids,
      })
      .expect(200);
  }
  const created = [];
  for (let i = 0; i < 5; i++) {
    const item = (
      await request(app)
        .post('/api/v1/listings')
        .set(auth(bob))
        .send({
          title: i === 0 ? `Gardening ${marker}` : `Guide ${i}`,
          description: `A guide for gardeners ${marker}`,
          condition: i === 4 ? 'fair' : 'good',
        })
        .expect(201)
    ).body;
    created.push(item);
  }
  // Ties require exact database microseconds and UUID tie breakers in both directions.
  await migration.query(
    "UPDATE public.listings SET created_at='2026-09-01T00:00:00.123456Z' WHERE owner_id=$1",
    [bob.id],
  );
  await migration.query(
    "UPDATE public.listings SET availability='reserved' WHERE id=$1",
    [created[4].id],
  );
  const expected = created
    .slice(0, 4)
    .map((item) => item.id)
    .sort();
  for (const sort of ['newest', 'oldest']) {
    let cursor;
    const ids = [];
    do {
      const page = await search({
        sort,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      listingPageSchema.parse(page);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(
      ids,
      sort === 'oldest' ? expected : [...expected].reverse(),
    );
  }
  assert.equal((await search({ condition: 'fair' })).items.length, 0);
  assert.equal((await search({ availability: 'reserved' })).items.length, 1);
  assert.equal((await search({ availability: 'all' })).items.length, 5);
  assert.equal((await search({ q: `garden ${marker}` })).items.length, 4);
  assert.equal(
    (await search({ q: `"guide for gardeners" ${marker}` })).items.length,
    4,
  );
  assert.equal((await search({ q: `absent${marker}` })).items.length, 0);
  assert.equal(
    (await search({ q: "'; DROP TABLE listings; --" })).items.length,
    0,
  );
  const empty = await search({ q: '  ', owner: bob.id });
  assert.equal(empty.items.length, 4);
  await request(app)
    .put(`/api/v1/listings/${created[0].id}`)
    .set(auth(bob))
    .send({
      title: `Updated ${marker}`,
      description: `Telescope ${marker}`,
      condition: 'good',
      revision: 1,
    })
    .expect(200);
  assert.deepEqual(
    (await search({ q: `telescope ${marker}` })).items.map((item) => item.id),
    [created[0].id],
  );
  await request(app)
    .post(`/api/v1/listings/${created[1].id}/withdraw`)
    .set(auth(bob))
    .send({ revision: 1 })
    .expect(200);
  assert.ok(
    !(await search({ availability: 'all' })).items.some(
      (item) => item.id === created[1].id,
    ),
  );
  const discover = async (user, query = {}) =>
    (
      await request(app)
        .get(user ? '/api/v1/members/discovery' : '/api/v1/members')
        .set(user ? auth(user) : {})
        .query({ limit: 50, ...query })
        .expect(200)
    ).body;
  await migration.query(
    'INSERT INTO public.account_restrictions (user_id, reason) VALUES ($1,$2)',
    [dan.id, 'Private synthetic restriction'],
  );
  const page = await discover(alice);
  memberPageSchema.parse(page);
  assert.ok(!page.items.some((member) => member.id === alice.id));
  for (const [user, count] of [
    [bob, 2],
    [carol, 1],
    [dan, 0],
  ]) {
    const member = page.items.find((member) => member.id === user.id);
    assert.ok(member);
    assert.equal(member.sharedInterestCount, count);
    assert.deepEqual(
      member.sharedInterests.map((interest) => interest.id).sort(),
      interestIds.slice(0, count).sort(),
    );
    assert.deepEqual(
      Object.keys(member).sort(),
      [
        'id',
        'displayName',
        'biography',
        'approximateLocation',
        'avatarUrl',
        'interests',
        'sharedInterests',
        'sharedInterestCount',
      ].sort(),
    );
  }
  const filtered = await discover(alice, { interest: interestIds[1] });
  assert.ok(filtered.items.some((member) => member.id === bob.id));
  assert.ok(
    !filtered.items.some((member) => [carol.id, dan.id].includes(member.id)),
  );
  assert.equal(
    (await discover(alice, { interest: randomUUID() })).items.length,
    0,
  );
  let cursor;
  const memberIds = [];
  do {
    const response = await discover(alice, {
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    memberIds.push(...response.items.map((member) => member.id));
    cursor = response.nextCursor;
  } while (cursor);
  assert.equal(new Set(memberIds).size, memberIds.length);
  assert.deepEqual(
    memberIds,
    page.items.map((member) => member.id),
  );
  assert.ok(memberIds.indexOf(bob.id) < memberIds.indexOf(carol.id));
  assert.ok(memberIds.indexOf(carol.id) < memberIds.indexOf(dan.id));
  const publicPage = await discover();
  for (const member of publicPage.items) {
    assert.equal(member.sharedInterestCount, null);
    assert.deepEqual(member.sharedInterests, []);
  }
  const fromBob = await discover(bob);
  assert.equal(
    fromBob.items.find((member) => member.id === carol.id).sharedInterestCount,
    1,
  );
  for (const query of [
    { q: 'x'.repeat(121) },
    { condition: 'unknown' },
    { sort: 'distance' },
    { availability: 'withdrawn' },
    { cursor: Buffer.from('{}').toString('base64url') },
  ]) {
    await request(app).get('/api/v1/listings').query(query).expect(400);
  }
  await request(app).get('/api/v1/members/discovery').expect(401);
  await request(app)
    .get('/api/v1/members/discovery')
    .set({ Authorization: 'Bearer forged' })
    .expect(401);
  await request(app)
    .get('/api/v1/members')
    .query({ userId: alice.id })
    .expect(400);
  console.info(
    'Local discovery: full-text/phrase/stem search, updates, empty/invalid filters, availability, precise cursor ties in both sorts, interest IDs/overlap, identity, pagination and public projections passed.',
  );
} finally {
  await fixture.cleanup();
}
