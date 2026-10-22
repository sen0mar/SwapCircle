// Real Express/runtime-role transactions against a disposable local schema replay.
// Synthetic verifier identities are injected only into this test application.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
import { Pool } from 'pg';
import request from 'supertest';
import { databaseConfig } from '@swapcircle/database';
import { testTwoPersonDatabase } from '../../../packages/database/scripts/test-two-person.ts';
import { createApp } from '../dist/app.js';
import { TradesService } from '../dist/features/trades/trades.service.js';
import { TradesRepository } from '../dist/features/trades/trades.repository.js';
import { ConversationsService } from '../dist/features/conversations/conversations.service.js';
import { ConversationsRepository } from '../dist/features/conversations/conversations.repository.js';

assert.equal(process.env.NODE_ENV, 'development');
for (const value of [
  process.env.DATABASE_URL,
  process.env.MIGRATION_DATABASE_URL,
]) {
  const target = new URL(value);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55432');
  assert.equal(target.pathname, '/postgres');
}
await testTwoPersonDatabase(async (database) => {
  const runtime = new Pool({
    ...databaseConfig(process.env.DATABASE_URL),
    database,
  });
  const migration = new Pool({
    ...databaseConfig(process.env.MIGRATION_DATABASE_URL, false),
    database,
  });
  const [alice, bob, outsider] = [randomUUID(), randomUUID(), randomUUID()];
  const app = createApp({
    allowedOrigins: [],
    verifyToken: async (token) =>
      [alice, bob, outsider].includes(token) ? token : null,
    trades: new TradesService(new TradesRepository(runtime)),
    conversations: new ConversationsService(
      new ConversationsRepository(runtime),
    ),
  });
  const as = (user) => ({ Authorization: `Bearer ${user}` });
  const accept = (id, user, key = randomUUID(), version = 1) =>
    request(app)
      .post(`/api/v1/trades/${id}/accept`)
      .set(as(user))
      .send({ operationKey: key, expectedVersion: version });
  const detail = async (id) =>
    (await request(app).get(`/api/v1/trades/${id}`).set(as(alice)).expect(200))
      .body;
  const make = async (shared) => {
    const items = [shared ?? randomUUID(), randomUUID()];
    for (const [index, user] of [alice, bob].entries()) {
      if (index === 0 && shared) continue;
      await migration.query(
        "INSERT INTO public.listings(id,owner_id,title,description,condition) VALUES ($1,$2,'Synthetic pair item','Disposable pair test','good')",
        [items[index], user],
      );
    }
    const terms = {
      participantIds: [alice, bob],
      transfers: items.map((listingId, i) => ({
        listingId,
        ownerId: [alice, bob][i],
        recipientId: [bob, alice][i],
      })),
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    const input = { ...terms, operationKey: randomUUID() };
    const result = await request(app)
      .post('/api/v1/trades')
      .set(as(alice))
      .send(input)
      .expect(201);
    assert.equal(
      (
        await request(app)
          .post('/api/v1/trades')
          .set(as(alice))
          .send(input)
          .expect(201)
      ).body.id,
      result.body.id,
    );
    return { id: result.body.id, terms, items };
  };
  try {
    await migration.query('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [
      alice,
      bob,
      outsider,
    ]);
    await migration.query(
      "INSERT INTO public.profiles(id,display_name) VALUES ($1,'Synthetic Alice'),($2,'Synthetic Bob'),($3,'Synthetic outsider')",
      [alice, bob, outsider],
    );
    const editable = await make();
    const before = await detail(editable.id);
    await request(app)
      .put(`/api/v1/trades/${editable.id}`)
      .set(as(alice))
      .send({
        ...editable.terms,
        participantIds: [alice, outsider],
        transfers: editable.terms.transfers.map((t) => ({
          ...t,
          ownerId: t.ownerId === bob ? outsider : alice,
          recipientId: t.recipientId === bob ? outsider : alice,
        })),
        expectedVersion: 1,
      })
      .expect(422);
    assert.deepEqual(await detail(editable.id), before);
    await accept(editable.id, alice).expect(200);
    await request(app)
      .put(`/api/v1/trades/${editable.id}`)
      .set(as(bob))
      .send({ ...editable.terms, expectedVersion: 1 })
      .expect(200);
    assert.ok(
      (await detail(editable.id)).participants.every(
        (p) => p.acceptedVersion === null,
      ),
    );
    await accept(editable.id, bob).expect(409);
    await accept(editable.id, alice, randomUUID(), 2).expect(200);
    await accept(editable.id, bob, randomUUID(), 2).expect(200);
    await request(app)
      .get(`/api/v1/trades/${editable.id}`)
      .set(as(outsider))
      .expect(404);

    const first = await make();
    const second = await make(first.items[0]);
    await accept(first.id, alice).expect(200);
    await accept(second.id, alice).expect(200);
    const race = await Promise.all([
      accept(first.id, bob),
      accept(second.id, bob),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const winner = race[0].status === 200 ? first : second;
    const loser = winner === first ? second : first;
    assert.equal((await detail(winner.id)).status, 'confirmed');
    assert.equal((await detail(loser.id)).status, 'proposed');
    assert.equal(
      (await detail(loser.id)).participants.filter(
        (p) => p.acceptedVersion !== null,
      ).length,
      1,
    );
    const receipt = (user, key) =>
      request(app)
        .post(`/api/v1/trades/${winner.id}/receipt`)
        .set(as(user))
        .send({ expectedVersion: 1, operationKey: key });
    const key = randomUUID();
    await receipt(alice, key).expect(200);
    await receipt(alice, key).expect(200);
    await receipt(bob, randomUUID()).expect(200);
    assert.equal((await detail(winner.id)).status, 'completed');
    assert.ok(
      (await detail(winner.id)).items.every(
        (item) => item.currentAvailability === 'exchanged',
      ),
    );
    const direct = (
      await request(app)
        .post('/api/v1/conversations/direct')
        .set(as(alice))
        .send({ userId: bob })
        .expect(200)
    ).body;
    const payload = {
      conversation_id: direct.id,
      body: 'Synthetic two-person message',
      client_message_id: randomUUID(),
    };
    const message = (
      await request(app)
        .post('/api/v1/conversations/messages')
        .set(as(alice))
        .send(payload)
        .expect(200)
    ).body;
    assert.equal(
      (
        await request(app)
          .post('/api/v1/conversations/messages')
          .set(as(alice))
          .send(payload)
          .expect(200)
      ).body.id,
      message.id,
    );
    await request(app)
      .post('/api/v1/conversations/messages')
      .set(as(outsider))
      .send({ ...payload, client_message_id: randomUUID() })
      .expect(403);
    await request(app)
      .put(`/api/v1/conversations/${direct.id}/invitation/accept`)
      .set(as(bob))
      .send({})
      .expect(404);
    console.info(
      'Disposable API: fixed-pair revisions, stale acceptance, retry safety, reservation race/rollback, unanimous completion and direct-message isolation passed.',
    );
  } finally {
    await Promise.all([runtime.end(), migration.end()]);
  }
});
