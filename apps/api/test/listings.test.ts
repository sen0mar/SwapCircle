import assert from 'node:assert/strict';
import { test } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { ListingsRepository } from '../src/features/listings/listings.repository.js';
import { ListingsService } from '../src/features/listings/listings.service.js';
import {
  apiErrorSchema,
  listingCreateSchema,
  listingUpdateSchema,
} from '@swapcircle/contracts';

// No connection is configured: rejected requests must never reach persistence.
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => '5c56caec-2d79-4d5d-920c-35e90dc476bf',
  listings: new ListingsService(new ListingsRepository(new Pool())),
});
const data = {
  title: 'Book',
  description: 'A synthetic book',
  condition: 'good',
};

test('listing writes reject missing authentication before persistence', async () => {
  for (const [method, path] of [
    ['post', '/listings'],
    ['put', '/listings/id'],
    ['post', '/listings/id/withdraw'],
  ] as const) {
    const pending = request(app)[method](`/api/v1${path}`);

    const result = await pending.send(data).expect(401);
    apiErrorSchema.parse(result.body);
  }
});

test('My Shelf requires authentication before persistence', async () => {
  const result = await request(app).get('/api/v1/listings/mine').expect(401);
  apiErrorSchema.parse(result.body);
});

test('My Shelf rejects owner and cursor query injection', async () => {
  for (const query of [{ ownerId: 'forged' }, { cursor: 'invalid' }]) {
    const result = await request(app)
      .get('/api/v1/listings/mine')
      .set('Authorization', 'Bearer synthetic')
      .query(query)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
});

test('listing contracts reject ownership, state and revision injection', () => {
  assert.equal(listingCreateSchema.safeParse(data).success, true);
  for (const extra of [
    { ownerId: 'someone' },
    { availability: 'reserved' },
    { revision: 2 },
    { createdAt: 'today' },
  ]) {
    assert.equal(
      listingCreateSchema.safeParse({ ...data, ...extra }).success,
      false,
    );
  }
  assert.equal(listingUpdateSchema.safeParse(data).success, false);
  assert.equal(
    listingUpdateSchema.safeParse({ ...data, revision: 0 }).success,
    false,
  );
});

test('invalid listing and cursor inputs produce safe errors before persistence', async () => {
  for (const body of [
    { ...data, ownerId: 'forged' },
    { ...data, title: '' },
    { ...data, condition: 'invalid' },
  ]) {
    const result = await request(app)
      .post('/api/v1/listings')
      .set('Authorization', 'Bearer synthetic')
      .send(body)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
  for (const query of [
    { limit: 51 },
    { limit: -1 },
    { cursor: 'invalid' },
    { cursor: Buffer.from('{}').toString('base64url') },
  ]) {
    const result = await request(app)
      .get('/api/v1/listings')
      .query(query)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
});
