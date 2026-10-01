import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { proposalRevisionSchema } from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { TradesService } from '../src/features/trades/trades.service.js';
import { TradesRepository } from '../src/features/trades/trades.repository.js';

const actor = randomUUID();
const peer = randomUUID();
const id = randomUUID();
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => actor,
  trades: new TradesService(new TradesRepository(new Pool())),
});
const revision = {
  expectedVersion: 1,
  expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  meetingMode: 'meet_to_swap',
  participantIds: [actor, peer],
  transfers: [
    { listingId: randomUUID(), ownerId: actor, recipientId: peer },
    { listingId: randomUUID(), ownerId: peer, recipientId: actor },
  ],
};

test('revision and version reads require verified authentication', async () => {
  await request(app).put(`/api/v1/trades/${id}`).send(revision).expect(401);
  await request(app).get(`/api/v1/trades/${id}/versions/1`).expect(401);
});

test('revision boundary rejects missing/stale-shape versions and identity injection', async () => {
  assert.equal(proposalRevisionSchema.safeParse(revision).success, true);
  for (const extra of [
    { expectedVersion: undefined },
    { expectedVersion: 0 },
    { expectedVersion: 1.5 },
    { actorId: peer },
    { status: 'confirmed' },
    { acceptedVersion: 1 },
    { operationKey: randomUUID() },
  ]) {
    await request(app)
      .put(`/api/v1/trades/${id}`)
      .set('Authorization', 'Bearer synthetic')
      .send({ ...revision, ...extra })
      .expect(400);
  }
  await request(app)
    .get(`/api/v1/trades/${id}/versions/0`)
    .set('Authorization', 'Bearer synthetic')
    .expect(400);
});
