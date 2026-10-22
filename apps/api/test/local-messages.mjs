import { Buffer } from 'node:buffer';
import sharp from 'sharp';
// Real PostgreSQL and verified local sessions; only guarded synthetic fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import console from 'node:console';
import request from 'supertest';
import { messageReceiptSchema } from '@swapcircle/contracts';
import { createDiscoveryFixture } from './discovery-fixture.mjs';
import { developmentLimits } from '../dist/features/safety/safety.permissions.js';
import { ConversationsRepository } from '../dist/features/conversations/conversations.repository.js';
import { ConversationsService } from '../dist/features/conversations/conversations.service.js';
import { SafetyPermissions } from '../dist/features/safety/safety.permissions.js';
import { createApp } from '../dist/app.js';

const fixture = await createDiscoveryFixture();
const {
  runtime,
  migration,
  users: [alice, bob, carol, dan],
} = fixture;
const app = fixture.makeApp({ ...developmentLimits, burstMax: 500 });
const auth = (user) => ({ Authorization: `Bearer ${user.token}` });
const send = (user, input, instance = app) =>
  request(instance)
    .post('/api/v1/conversations/messages')
    .set(auth(user))
    .send(input);
const input = (id, body = 'Synthetic plain text', key = randomUUID()) => ({
  conversation_id: id,
  body,
  client_message_id: key,
});
const start = async (user, other) =>
  (
    await request(app)
      .post('/api/v1/conversations/direct')
      .set(auth(user))
      .send({ userId: other.id })
      .expect(200)
  ).body.id;
const snapshot = async (id) =>
  (
    await migration.query(
      `SELECT last_message_order,(SELECT count(*)::int FROM public.messages WHERE conversation_id=$1) AS count
   FROM public.conversations WHERE id=$1`,
      [id],
    )
  ).rows[0];
const quota = async (user) =>
  (
    await migration.query(
      "SELECT used FROM public.action_quotas WHERE user_id=$1 AND action='message'",
      [user.id],
    )
  ).rows[0]?.used ?? 0;
const clearQuota = (user) =>
  migration.query(
    "DELETE FROM public.action_quotas WHERE user_id=$1 AND action='message'",
    [user.id],
  );

try {
  for (const user of [alice, bob, carol, dan])
    await request(app).get('/api/v1/profiles/me').set(auth(user)).expect(200);
  const direct = await start(alice, bob);
  const other = await start(alice, carol);

  const originalInput = input(
    direct,
    '  <script>plain text & preserved whitespace</script>  ',
  );
  await request(app)
    .post('/api/v1/conversations/messages')
    .send(originalInput)
    .expect(401);
  await request(app)
    .post('/api/v1/conversations/messages')
    .set('Authorization', 'Bearer forged')
    .send(originalInput)
    .expect(401);
  for (const invalid of [
    { ...originalInput, sender_id: bob.id },
    { ...originalInput, body: '' },
    { ...originalInput, body: ' \n\t' },
    { ...originalInput, body: 'x'.repeat(5001) },
    { ...originalInput, client_message_id: 'invalid' },
    { ...originalInput, conversation_id: 'invalid' },
    {},
  ])
    await send(alice, invalid).expect(400);
  await send(carol, originalInput).expect(403);
  await send(alice, input(randomUUID())).expect(403);
  assert.deepEqual(await snapshot(direct), { last_message_order: 0, count: 0 });

  const first = messageReceiptSchema.parse(
    (await send(alice, originalInput).expect(200)).body,
  );
  assert.equal(first.sender_id, alice.id);
  assert.equal(first.body, originalInput.body);
  const repeats = await Promise.all(
    Array.from({ length: 6 }, () => send(alice, originalInput)),
  );
  for (const result of repeats) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, first);
  }
  assert.equal(await quota(alice), 7);
  const upper = {
    ...originalInput,
    conversation_id: direct.toUpperCase(),
    client_message_id: originalInput.client_message_id.toUpperCase(),
  };
  assert.deepEqual((await send(alice, upper).expect(200)).body, first);
  for (const changed of [
    { ...originalInput, body: 'changed' },
    { ...originalInput, conversation_id: other },
  ]) {
    const conflict = await send(alice, changed).expect(409);
    assert.equal(conflict.body.error.code, 'MESSAGE_RETRY_CONFLICT');
  }
  const freshRetry = input(direct, 'x'.repeat(5000));
  const freshRaces = await Promise.all(
    Array.from({ length: 6 }, () => send(alice, freshRetry)),
  );
  for (const result of freshRaces) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, freshRaces[0].body);
  }
  assert.equal(
    (
      await migration.query(
        'SELECT 1 FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
        [alice.id, freshRetry.client_message_id],
      )
    ).rowCount,
    1,
  );
  const raceKey = randomUUID();
  const races = await Promise.all([
    send(alice, input(direct, 'race A', raceKey)),
    send(alice, input(other, 'race B', raceKey)),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  const sameKey = randomUUID();
  const contentRace = await Promise.all([
    send(alice, input(direct, 'A', sameKey)),
    send(alice, input(direct, 'B', sameKey)),
  ]);
  assert.deepEqual(contentRace.map((r) => r.status).sort(), [200, 409]);
  const before = await snapshot(direct);
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      send(i % 2 ? bob : alice, input(direct)),
    ),
  );
  assert.ok(concurrent.every((r) => r.status === 200));
  const orders = concurrent
    .map((r) => r.body.message_order)
    .sort((a, b) => a - b);
  assert.deepEqual(
    orders,
    Array.from({ length: 10 }, (_, i) => before.last_message_order + i + 1),
  );
  // The same key belongs to the sender, not the conversation or another sender.
  await send(bob, originalInput).expect(200);

  const stable = await snapshot(direct);
  const expectDeniedRetry = async (user = alice) => {
    await send(user, originalInput).expect(403);
    await send(user, input(direct)).expect(403);
    assert.deepEqual(await snapshot(direct), stable);
  };
  for (const member of [alice, bob]) {
    await migration.query(
      'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
      [direct, member.id],
    );
    await expectDeniedRetry();
    await migration.query(
      'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
      [direct, member.id],
    );
    await migration.query(
      'INSERT INTO public.account_restrictions (user_id,reason) VALUES ($1,$2)',
      [member.id, 'Synthetic restriction'],
    );
    await expectDeniedRetry();
    await migration.query(
      'DELETE FROM public.account_restrictions WHERE user_id=$1',
      [member.id],
    );
    const blocked = member === alice ? bob : alice;
    await request(app)
      .put('/api/v1/safety/blocks')
      .set(auth(member))
      .send({ userId: blocked.id })
      .expect(204);
    await expectDeniedRetry();
    await request(app)
      .delete(`/api/v1/safety/blocks/${blocked.id}`)
      .set(auth(member))
      .expect(204);
  }

  // An uncommitted block owns the same ordered account locks as send/retry.
  const blocker = await runtime.connect();
  try {
    await blocker.query('BEGIN');
    for (const id of [alice.id, bob.id].sort())
      await blocker.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`safety:${id}`],
      );
    await blocker.query(
      'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
      [bob.id, alice.id],
    );
    let settled = false;
    const pending = send(alice, originalInput).then((r) => {
      settled = true;
      return r;
    });
    await setTimeout(40);
    assert.equal(settled, false);
    await blocker.query('COMMIT');
    assert.equal((await pending).status, 403);
    assert.deepEqual(await snapshot(direct), stable);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await request(app)
    .delete(`/api/v1/safety/blocks/${alice.id}`)
    .set(auth(bob))
    .expect(204);

  await clearQuota(alice);
  const limited = fixture.makeApp({ ...developmentLimits, allowance: 1 });
  const limitedInput = input(direct);
  await send(alice, limitedInput, limited).expect(200);
  const limitedSnapshot = await snapshot(direct);
  for (const attempt of [limitedInput, input(direct)]) {
    const result = await send(alice, attempt, limited).expect(429);
    assert.equal(result.body.error.code, 'ACTION_LIMIT');
    assert.ok(result.headers['retry-after']);
  }
  assert.deepEqual(await snapshot(direct), limitedSnapshot);
  assert.equal(await quota(alice), 1);
  await migration.query(
    "UPDATE public.action_quotas SET window_started_at=statement_timestamp()-interval '2 hours' WHERE user_id=$1 AND action='message'",
    [alice.id],
  );
  await send(alice, limitedInput, limited).expect(200);
  assert.equal(await quota(alice), 1);
  await clearQuota(bob);
  const quotaRaces = await Promise.all([
    send(bob, input(direct), limited),
    send(bob, input(direct), limited),
  ]);
  assert.deepEqual(quotaRaces.map((r) => r.status).sort(), [200, 429]);
  assert.equal(await quota(bob), 1);
  const burst = fixture.makeApp({ ...developmentLimits, burstMax: 1 });
  await send(bob, originalInput, burst).expect(200);
  assert.equal(
    (await send(bob, originalInput, burst).expect(429)).body.error.code,
    'BURST_LIMIT',
  );

  // Inject a failure after real INSERT/trigger execution: message, order and quota
  // must all roll back, and retry must safely produce the first durable result.
  class FailingRepository extends ConversationsRepository {
    async insertMessage(client, actor, value) {
      await super.insertMessage(client, actor, value);
      throw new Error('Synthetic persistence failure');
    }
  }
  await clearQuota(alice);
  const failedApp = createApp({
    allowedOrigins: [],
    verifyToken: async () => alice.id,
    conversations: new ConversationsService(
      new FailingRepository(runtime),
      new SafetyPermissions(),
    ),
  });
  const failedInput = input(direct);
  const prior = await snapshot(direct);
  const failure = await send(alice, failedInput, failedApp).expect(500);
  assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(failure.body).includes('Synthetic'));
  assert.deepEqual(await snapshot(direct), prior);
  assert.equal(await quota(alice), 0);
  const recovered = (await send(alice, failedInput).expect(200)).body;
  assert.equal(recovered.message_order, prior.last_message_order + 1);
  assert.equal(await quota(alice), 1);
  // The listing proposal entry point sends one message with an optional private image.
  const offerListing = randomUUID();
  await migration.query(
    "INSERT INTO public.listings (id,owner_id,title,description,condition) VALUES ($1,$2,'Synthetic bicycle','Offer photo test','good')",
    [offerListing, bob.id],
  );
  const offer = {
    listingId: offerListing,
    body: 'I can offer a lamp.',
    clientMessageId: randomUUID(),
    photoBase64: (
      await sharp({
        create: { width: 24, height: 24, channels: 3, background: 'red' },
      })
        .png()
        .toBuffer()
    ).toString('base64'),
  };
  const propose = (value, instance = app) =>
    request(instance)
      .post('/api/v1/conversations/proposals')
      .set(auth(alice))
      .send(value);
  const receipts = await Promise.all([propose(offer), propose(offer)]);
  assert.deepEqual(
    receipts.map((result) => result.status),
    [200, 200],
  );
  const offerMessage = messageReceiptSchema.parse(receipts[0].body);
  assert.equal(offerMessage.id, receipts[1].body.id);
  assert.equal(offerMessage.has_photo, true);
  assert.deepEqual(offerMessage.proposal, {
    listingId: offerListing,
    listingTitle: 'Synthetic bicycle',
    message: offer.body,
  });
  const recipientHistory = await bob.client
    .from('messages')
    .select('proposal')
    .eq('id', offerMessage.id)
    .single();
  assert.equal(recipientHistory.error, null);
  assert.deepEqual(recipientHistory.data.proposal, offerMessage.proposal);
  assert.equal(offerMessage.conversation_id, direct);
  assert.equal(
    offerMessage.body,
    'About “Synthetic bicycle”\n\nI can offer a lamp.',
  );
  const photoPath = `/api/v1/conversations/messages/${offerMessage.id}/photo`;
  for (const member of [alice, bob]) {
    const response = await request(app)
      .get(photoPath)
      .set(auth(member))
      .expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const metadata = await sharp(
      Buffer.from(response.body.dataUrl.split(',')[1], 'base64'),
    ).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
  }
  await request(app).get(photoPath).expect(401);
  await request(app).get(photoPath).set(auth(carol)).expect(403);
  const sdkRead = await alice.client.from('message_photos').select('*');
  assert.ok(
    sdkRead.error,
    'Private images must not be accessible through the browser SDK',
  );
  await propose({ ...offer, photoBase64: undefined }).expect(409);
  await propose({
    ...offer,
    clientMessageId: randomUUID(),
    photoBase64: Buffer.from('invalid image').toString('base64'),
  }).expect(415);
  const offerCount = await migration.query(
    'SELECT count(*)::int AS count FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
    [alice.id, offer.clientMessageId],
  );
  assert.equal(offerCount.rows[0].count, 1);

  class FailingPhotoRepository extends ConversationsRepository {
    async insertMessage(client, actor, value, photo, proposal) {
      await super.insertMessage(client, actor, value, photo, proposal);
      throw new Error('Synthetic attachment rollback');
    }
  }
  const failedPhotoApp = createApp({
    allowedOrigins: [],
    verifyToken: async () => alice.id,
    conversations: new ConversationsService(
      new FailingPhotoRepository(runtime),
      new SafetyPermissions(),
    ),
  });
  const failedOffer = { ...offer, clientMessageId: randomUUID() };
  await propose(failedOffer, failedPhotoApp).expect(500);
  const rolledBack = await migration.query(
    'SELECT id FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
    [alice.id, failedOffer.clientMessageId],
  );
  assert.equal(rolledBack.rowCount, 0);
  const photoCount = await migration.query(
    'SELECT count(*)::int AS count FROM public.message_photos p JOIN public.messages m ON m.id=p.message_id WHERE m.conversation_id=$1',
    [direct],
  );
  assert.equal(photoCount.rows[0].count, 1);
  await propose(failedOffer).expect(200);

  const proposalPath = (id) => `/api/v1/conversations/messages/${id}/proposal`;
  const respondProposal = (user, id, action, instance = app) =>
    request(instance).put(proposalPath(id)).set(auth(user)).send({ action });
  await request(app).get(proposalPath(offerMessage.id)).expect(401);
  await request(app)
    .get(proposalPath(offerMessage.id))
    .set(auth(carol))
    .expect(404);
  const pending = (
    await request(app)
      .get(proposalPath(offerMessage.id))
      .set(auth(bob))
      .expect(200)
  ).body;
  assert.equal(pending.status, 'pending');
  assert.equal(pending.recipientId, bob.id);
  await respondProposal(alice, offerMessage.id, 'accept').expect(403);
  await request(app)
    .put(proposalPath(offerMessage.id))
    .set(auth(bob))
    .send({ action: 'accept', actorId: alice.id })
    .expect(400);
  const accepted = await Promise.all([
    respondProposal(bob, offerMessage.id, 'accept'),
    respondProposal(bob, offerMessage.id, 'accept'),
  ]);
  assert.deepEqual(
    accepted.map((result) => result.status),
    [200, 200],
  );
  assert.deepEqual(accepted[0].body, accepted[1].body);
  assert.equal(accepted[0].body.status, 'accepted');
  await respondProposal(bob, offerMessage.id, 'refuse').expect(409);
  for (const user of [alice, bob]) {
    const page = (
      await request(app)
        .get('/api/v1/conversations/proposals/accepted')
        .set(auth(user))
        .expect(200)
    ).body;
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].message.id, offerMessage.id);
    assert.equal(page.items[0].response.status, 'accepted');
  }
  assert.equal(
    (
      await request(app)
        .get('/api/v1/conversations/proposals/accepted')
        .set(auth(carol))
        .expect(200)
    ).body.items.length,
    0,
  );
  const notificationCount = await migration.query(
    "SELECT count(*)::int AS count FROM public.notifications WHERE recipient_id=$1 AND event_type='proposal_response'",
    [alice.id],
  );
  assert.equal(notificationCount.rows[0].count, 1);
  const deniedSdk = await bob.client
    .from('message_proposal_responses')
    .select('*');
  assert.ok(deniedSdk.error);

  const refuseMessage = (
    await propose({
      ...offer,
      clientMessageId: randomUUID(),
      photoBase64: undefined,
    }).expect(200)
  ).body;
  await migration.query(
    'INSERT INTO public.blocks (blocker_id,blocked_id) VALUES ($1,$2)',
    [alice.id, bob.id],
  );
  await respondProposal(bob, refuseMessage.id, 'accept').expect(403);
  await migration.query(
    'DELETE FROM public.blocks WHERE blocker_id=$1 AND blocked_id=$2',
    [alice.id, bob.id],
  );
  await respondProposal(bob, refuseMessage.id, 'refuse').expect(200);
  await respondProposal(bob, refuseMessage.id, 'refuse').expect(200);
  await respondProposal(bob, refuseMessage.id, 'accept').expect(409);

  const racedMessage = (
    await propose({
      ...offer,
      clientMessageId: randomUUID(),
      photoBase64: undefined,
    }).expect(200)
  ).body;
  const raced = await Promise.all([
    respondProposal(bob, racedMessage.id, 'accept'),
    respondProposal(bob, racedMessage.id, 'refuse'),
  ]);
  assert.deepEqual(raced.map((result) => result.status).sort(), [200, 409]);
  const racedSaved = (
    await request(app)
      .get(proposalPath(racedMessage.id))
      .set(auth(alice))
      .expect(200)
  ).body;
  assert.equal(
    racedSaved.status,
    raced.find((result) => result.status === 200).body.status,
  );

  const failureMessage = (
    await propose({
      ...offer,
      clientMessageId: randomUUID(),
      photoBase64: undefined,
    }).expect(200)
  ).body;
  class FailedResponseRepository extends ConversationsRepository {
    async transaction(work) {
      return super.transaction(async (client) => {
        await work(client);
        throw new Error('Synthetic response rollback after notification');
      });
    }
  }
  const failedResponseApp = createApp({
    allowedOrigins: [],
    verifyToken: async () => bob.id,
    conversations: new ConversationsService(
      new FailedResponseRepository(runtime),
      new SafetyPermissions(),
    ),
  });
  const beforeFailure = (
    await migration.query(
      "SELECT count(*)::int AS count FROM public.notifications WHERE recipient_id=$1 AND event_type='proposal_response'",
      [alice.id],
    )
  ).rows[0].count;
  await respondProposal(
    bob,
    failureMessage.id,
    'accept',
    failedResponseApp,
  ).expect(500);
  assert.equal(
    (
      await request(app)
        .get(proposalPath(failureMessage.id))
        .set(auth(bob))
        .expect(200)
    ).body.status,
    'pending',
  );
  assert.equal(
    (
      await migration.query(
        "SELECT count(*)::int AS count FROM public.notifications WHERE recipient_id=$1 AND event_type='proposal_response'",
        [alice.id],
      )
    ).rows[0].count,
    beforeFailure,
  );
  await respondProposal(bob, failureMessage.id, 'accept').expect(200);

  const staleMessage = (
    await propose({
      ...offer,
      clientMessageId: randomUUID(),
      photoBase64: undefined,
    }).expect(200)
  ).body;
  await migration.query(
    'UPDATE public.listings SET updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1',
    [offerListing],
  );
  await respondProposal(bob, staleMessage.id, 'accept').expect(409);
  await respondProposal(bob, staleMessage.id, 'refuse').expect(200);
  const unavailableMessage = (
    await propose({
      ...offer,
      clientMessageId: randomUUID(),
      photoBase64: undefined,
    }).expect(200)
  ).body;
  await migration.query(
    "UPDATE public.listings SET availability='withdrawn' WHERE id=$1",
    [offerListing],
  );
  await respondProposal(bob, unavailableMessage.id, 'accept').expect(409);
  await respondProposal(bob, offerMessage.id, 'accept').expect(200);
  const firstPage = (
    await request(app)
      .get('/api/v1/conversations/proposals/accepted?limit=1')
      .set(auth(alice))
      .expect(200)
  ).body;
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  const nextPage = (
    await request(app)
      .get('/api/v1/conversations/proposals/accepted')
      .query({
        limit: 1,
        before: firstPage.nextCursor.respondedAt,
        beforeId: firstPage.nextCursor.id,
      })
      .set(auth(alice))
      .expect(200)
  ).body;
  assert.equal(nextPage.items.length, 1);
  assert.notEqual(firstPage.items[0].message.id, nextPage.items[0].message.id);
  console.info(
    'Message proposal decisions: recipient authorization, exact retries, accept/refuse races, blocked contact, stale/unavailable items, atomic decision/notification rollback, private reads and accepted pages for both participants passed.',
  );

  console.info(
    'Local messages: strict validation/auth, exact concurrent retries, cross-conversation/content conflicts, sender-wide deduplication, two-actor stable ordering, current memberships/restrictions/bidirectional blocks and racing block, persistent/retry/burst quotas, expiry and atomic failure rollback/recovery passed.',
  );
} finally {
  await fixture.cleanup();
}
