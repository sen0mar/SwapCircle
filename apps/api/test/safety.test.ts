import assert from 'node:assert/strict';
import { test } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { SafetyService } from '../src/features/safety/safety.service.js';
import { SafetyRepository } from '../src/features/safety/safety.repository.js';
import { developmentLimits } from '../src/features/safety/safety.permissions.js';
import { apiErrorSchema } from '@swapcircle/contracts';
import { readEnvironment } from '../src/env.js';

const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => '5c56caec-2d79-4d5d-920c-35e90dc476bf',
  safety: new SafetyService(new SafetyRepository(new Pool())),
});
const report = {
  clientReportId: randomUUID(),
  targetType: 'member',
  targetId: randomUUID(),
  reason: 'Synthetic report',
};

test('safety routes authenticate before persistence', async () => {
  await request(app).get('/api/v1/safety/blocks').expect(401);
  await request(app).get('/api/v1/safety/status').expect(401);
  await request(app)
    .put('/api/v1/safety/blocks')
    .send({ userId: randomUUID() })
    .expect(401);
  await request(app)
    .delete(`/api/v1/safety/blocks/${randomUUID()}`)
    .expect(401);
  await request(app).post('/api/v1/safety/reports').send(report).expect(401);
});

test('safety validation rejects forged owners, invalid targets, blank and oversized reasons', async () => {
  for (const data of [
    { ...report, reporterId: randomUUID() },
    { ...report, reason: ' ' },
    { ...report, reason: 'x'.repeat(2001) },
    { ...report, targetType: 'message' },
    { ...report, targetId: 'invalid' },
    { ...report, clientReportId: 'invalid' },
  ]) {
    const response = await request(app)
      .post('/api/v1/safety/reports')
      .set('Authorization', 'Bearer synthetic')
      .send(data)
      .expect(400);
    apiErrorSchema.parse(response.body);
    if (data.reason.trim())
      assert.ok(!JSON.stringify(response.body).includes(data.reason));
  }
  for (const data of [
    { userId: randomUUID(), blockerId: randomUUID() },
    { userId: 'invalid' },
  ])
    await request(app)
      .put('/api/v1/safety/blocks')
      .set('Authorization', 'Bearer synthetic')
      .send(data)
      .expect(400);
  await request(app)
    .get('/api/v1/safety/blocks')
    .set('Authorization', 'Bearer synthetic')
    .query({ ownerId: randomUUID() })
    .expect(400);
});

test('private status rejects forged actors and malformed targets', async () => {
  for (const query of [{ actor: randomUUID() }, { userId: 'invalid' }])
    await request(app)
      .get('/api/v1/safety/status')
      .set('Authorization', 'Bearer synthetic')
      .query(query)
      .expect(400);
});

test('burst limit has safe errors and Retry-After, ignores reads and forwarded address spoofing', async () => {
  const limited = createApp({
    allowedOrigins: [],
    limits: { ...developmentLimits, burstMax: 1 },
  });
  await request(limited).post('/api/v1/unknown').expect(404);
  const result = await request(limited)
    .post('/api/v1/unknown')
    .set('X-Forwarded-For', '192.0.2.10')
    .expect(429);
  apiErrorSchema.parse(result.body);
  assert.equal(result.body.error.code, 'BURST_LIMIT');
  assert.ok(Number(result.headers['retry-after']) > 0);
  await request(limited).get('/api/v1/live').expect(200);
});

test('invalid quota configuration fails safely', () => {
  for (const key of [
    'WRITE_ALLOWANCE',
    'WRITE_WINDOW_SECONDS',
    'WRITE_BURST_MAX',
    'WRITE_BURST_WINDOW_MS',
  ]) {
    assert.throws(
      () => readEnvironment({ [key]: 'sensitive-invalid-value' }),
      (error) =>
        error instanceof Error &&
        error.message.includes(key) &&
        !error.message.includes('sensitive-invalid-value'),
    );
  }
});
