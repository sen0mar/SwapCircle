import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import {
  proposalCreationSchema,
  proposalRevisionSchema,
} from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { TradesService } from '../src/features/trades/trades.service.js';
import { TradesRepository } from '../src/features/trades/trades.repository.js';
import { listings, swaps } from '../scripts/demo/manifest.js';

const [alice, bob, carol] = [randomUUID(), randomUUID(), randomUUID()];
const input = {
  operationKey: randomUUID(),
  participantIds: [alice, bob],
  transfers: [
    { listingId: randomUUID(), ownerId: alice, recipientId: bob },
    { listingId: randomUUID(), ownerId: alice, recipientId: bob },
    { listingId: randomUUID(), ownerId: bob, recipientId: alice },
  ],
  meetingMode: 'meet_to_swap',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => alice,
  trades: new TradesService(new TradesRepository(new Pool())),
});

test('two people can exchange multiple items without equal item counts', () => {
  expect(proposalCreationSchema.safeParse(input).success).toBe(true);
});

test('creation and revision reject extra, duplicate, missing and outside participants before persistence', async () => {
  for (const invalid of [
    { participantIds: [alice] },
    { participantIds: [alice, alice] },
    { participantIds: [alice, bob, carol] },
    {
      transfers: [
        ...input.transfers,
        { listingId: randomUUID(), ownerId: carol, recipientId: alice },
      ],
    },
  ]) {
    const creation = { ...input, ...invalid };
    const revision = {
      participantIds: creation.participantIds,
      transfers: creation.transfers,
      meetingMode: creation.meetingMode,
      expiresAt: creation.expiresAt,
      expectedVersion: 1,
    };
    expect(proposalCreationSchema.safeParse(creation).success).toBe(false);
    expect(proposalRevisionSchema.safeParse(revision).success).toBe(false);
    await request(app)
      .post('/api/v1/trades')
      .set('Authorization', 'Bearer synthetic')
      .send(creation)
      .expect(400);
    await request(app)
      .put(`/api/v1/trades/${randomUUID()}`)
      .set('Authorization', 'Bearer synthetic')
      .send(revision)
      .expect(400);
  }
});

test('every demo swap involves two distinct owners and includes its creator', () => {
  for (const swap of swaps) {
    const owners = new Set(
      swap.items.map((key) => listings.find((item) => item.key === key)?.owner),
    );
    expect(owners.size).toBe(2);
    expect(owners.has(swap.creator)).toBe(true);
    expect(owners.has(undefined)).toBe(false);
  }
});
