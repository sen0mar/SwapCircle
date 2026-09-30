// Synthetic proposals on the guarded local stack only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import console from 'node:console';
import request from 'supertest';
import { tradeDetailSchema, tradePageSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';

const fixture = await createDiscoveryFixture();
const [alice, bob, , dana] = fixture.users;
const app = fixture.app;
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const listingIds = new Map();

async function seed(size) {
  const members = fixture.users.slice(0, size);
  const tradeId = randomUUID();
  const versionId = randomUUID();
  const db = await fixture.migration.connect();

  await db.query('BEGIN');
  try {
    await db.query(
      `INSERT INTO public.trades (id, creator_id, expires_at)
       VALUES ($1,$2,now()+interval '7 days')`,
      [tradeId, alice.id],
    );
    for (const member of members)
      await db.query(
        'INSERT INTO public.trade_participants (trade_id,user_id) VALUES ($1,$2)',
        [tradeId, member.id],
      );
    await db.query(
      'INSERT INTO public.trade_versions (id,trade_id,version,created_by) VALUES ($1,$2,1,$3)',
      [versionId, tradeId, alice.id],
    );
    for (const [index, owner] of members.entries()) {
      const recipient = members[(index + 1) % size];
      for (const listingId of listingIds.get(owner.id))
        await db.query(
          `INSERT INTO public.trade_items
           (trade_id,version_id,listing_id,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot)
           SELECT $1,$2,id,owner_id,$3,revision,title,description,condition
           FROM public.listings WHERE id=$4`,
          [tradeId, versionId, recipient.id, listingId],
        );
    }
    await db.query(
      'INSERT INTO public.trade_events (trade_id,version_id,actor_id,event_type) VALUES ($1,$2,$3,$4)',
      [tradeId, versionId, alice.id, 'proposed'],
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }

  return { tradeId, versionId, members };
}

try {
  for (const user of fixture.users) {
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
    const ids = [];
    for (let index = 0; index < 2; index++) {
      const id = randomUUID();
      ids.push(id);
      await fixture.migration.query(
        `INSERT INTO public.listings (id,owner_id,title,description,condition)
         VALUES ($1,$2,$3,'Synthetic trade item','good')`,
        [id, user.id, `Synthetic item ${index + 1}`],
      );
    }
    listingIds.set(user.id, ids);
  }

  const proposals = [];
  for (const size of [2, 3, 4]) proposals.push(await seed(size));

  for (const { tradeId, members } of proposals) {
    for (const user of members) {
      const response = await request(app)
        .get(`/api/v1/trades/${tradeId}`)
        .set(auth(user))
        .expect(200);
      const detail = tradeDetailSchema.parse(response.body);
      assert.equal(detail.status, 'proposed');
      assert.equal(detail.participants.length, members.length);
      assert.equal(detail.items.length, members.length * 2);
      assert.equal(detail.events.length, 1);
      assert.ok(
        detail.participants.every(
          (p) => p.invitationStatus === 'invited' && p.acceptedVersion === null,
        ),
      );
      for (const owner of members) {
        const transfers = detail.items.filter(
          (item) => item.ownerId === owner.id,
        );
        assert.equal(transfers.length, 2);
        assert.ok(
          transfers.every(
            (item) =>
              item.recipientId !== owner.id && item.listingRevision === 1,
          ),
        );
      }
    }
  }

  const outsider = await request(app)
    .get(`/api/v1/trades/${proposals[0].tradeId}`)
    .set(auth(dana))
    .expect(404);
  assert.equal(outsider.body.error.code, 'TRADE_UNAVAILABLE');
  await request(app)
    .get(`/api/v1/trades/${randomUUID()}`)
    .set(auth(alice))
    .expect(404);
  await request(app)
    .get('/api/v1/trades/not-a-uuid')
    .set(auth(alice))
    .expect(400);
  await request(app).get(`/api/v1/trades/${proposals[0].tradeId}`).expect(401);

  const alicePage = tradePageSchema.parse(
    (
      await request(app)
        .get('/api/v1/trades/mine?limit=2')
        .set(auth(alice))
        .expect(200)
    ).body,
  );
  assert.equal(alicePage.items.length, 2);
  assert.ok(alicePage.nextAfter);
  const next = tradePageSchema.parse(
    (
      await request(app)
        .get(`/api/v1/trades/mine?limit=2&after=${alicePage.nextAfter}`)
        .set(auth(alice))
        .expect(200)
    ).body,
  );
  assert.equal(next.items.length, 1);
  assert.equal(next.nextAfter, null);
  assert.equal(
    new Set([...alicePage.items, ...next.items].map((item) => item.id)).size,
    3,
  );
  assert.equal(
    tradePageSchema.parse(
      (
        await request(app)
          .get('/api/v1/trades/mine')
          .set(auth(dana))
          .expect(200)
      ).body,
    ).items.length,
    1,
  );

  for (const table of [
    'trades',
    'trade_versions',
    'trade_participants',
    'trade_items',
    'trade_events',
  ]) {
    const result = await bob.client.from(table).select('*');
    assert.ok(result.error, `browser read of ${table} must be denied`);
    const insert = await bob.client.from(table).insert({ id: randomUUID() });
    assert.ok(insert.error, `browser write of ${table} must be denied`);
  }

  const { tradeId, versionId } = proposals[0];
  await assert.rejects(
    fixture.migration.query(
      `INSERT INTO public.trade_items (trade_id,version_id,listing_id,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot)
     VALUES ($1,$2,$3,$4,$5,1,'Invalid','Invalid','good')`,
      [tradeId, versionId, listingIds.get(alice.id)[0], alice.id, dana.id],
    ),
  );
  await assert.rejects(
    fixture.migration.query(
      `INSERT INTO public.trade_items (trade_id,version_id,listing_id,owner_id,recipient_id,listing_revision,title_snapshot,description_snapshot,condition_snapshot)
     VALUES ($1,$2,$3,$4,$5,1,'Invalid','Invalid','good')`,
      [tradeId, versionId, randomUUID(), alice.id, bob.id],
    ),
  );
  await assert.rejects(
    fixture.migration.query(
      'UPDATE public.trade_events SET event_type=$1 WHERE trade_id=$2',
      ['cancelled', tradeId],
    ),
  );
  await assert.rejects(
    fixture.migration.query(
      'DELETE FROM public.trade_events WHERE trade_id=$1',
      [tradeId],
    ),
  );

  await fixture.migration.query(
    'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
    [bob.id, 'synthetic'],
  );
  await request(app)
    .get(`/api/v1/trades/${tradeId}`)
    .set(auth(bob))
    .expect(403);
  await request(app).get('/api/v1/trades/mine').set(auth(bob)).expect(403);
  await fixture.migration.query(
    'DELETE FROM public.account_restrictions WHERE user_id=$1',
    [bob.id],
  );

  console.log(
    'Trade reads, multi-member transfers, outsider denial, references, RLS, and append-only events passed.',
  );
} finally {
  await fixture.cleanup();
}
