import assert from 'node:assert/strict';
import { test } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { ListingsRepository } from '../src/features/listings/listings.repository.js';
import { ListingsService } from '../src/features/listings/listings.service.js';
import { ProfilesRepository } from '../src/features/profiles/profiles.repository.js';
import { ProfilesService } from '../src/features/profiles/profiles.service.js';
import {
  apiErrorSchema,
  catalogQuerySchema,
  memberQuerySchema,
} from '@swapcircle/contracts';

const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => '5c56caec-2d79-4d5d-920c-35e90dc476bf',
  listings: new ListingsService(new ListingsRepository(new Pool())),
  profiles: new ProfilesService(new ProfilesRepository(new Pool())),
});

test('catalog rejects unsupported filters, oversized searches and query arrays before persistence', async () => {
  for (const query of [
    { q: 'x'.repeat(121) },
    { condition: 'unknown' },
    { availability: 'withdrawn' },
    { sort: 'distance' },
    { distance: 10 },
    { owner: 'invalid' },
    { q: ['one', 'two'] },
  ]) {
    const result = await request(app)
      .get('/api/v1/listings')
      .query(query)
      .expect(400);
    apiErrorSchema.parse(result.body);
  }
  assert.equal(catalogQuerySchema.parse({ q: '  ' }).q, '');
  assert.equal(catalogQuerySchema.parse({}).availability, 'available');
});

test('discovery derives identity from authentication and rejects forged actors and invalid filters', async () => {
  await request(app).get('/api/v1/members/discovery').expect(401);
  for (const path of ['/members', '/members/discovery']) {
    for (const query of [
      { userId: 'forged' },
      { interestIds: ['forged'] },
      { interest: 'invalid' },
      { limit: 51 },
      { cursor: 'invalid' },
    ]) {
      const result = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', 'Bearer synthetic')
        .query(query)
        .expect(400);
      apiErrorSchema.parse(result.body);
    }
  }
  assert.equal(
    memberQuerySchema.safeParse({ interest: 'not-an-id' }).success,
    false,
  );
});
