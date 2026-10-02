import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { coffeeSendSchema, coffeeResponseSchema } from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { CoffeeService } from '../src/features/coffee/coffee.service.js';
import { CoffeeRepository } from '../src/features/coffee/coffee.repository.js';

const actor = randomUUID();
const id = randomUUID();
const invitation = randomUUID();
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => actor,
  coffee: new CoffeeService(new CoffeeRepository(new Pool())),
});
const input = { inviteeId: randomUUID(), operationKey: randomUUID() };

test('coffee routes require authentication before private reads or writes', async () => {
  await request(app).get(`/api/v1/trades/${id}/coffee`).expect(401);
  await request(app).get(`/api/v1/trades/${id}/coffee/eligibility`).expect(401);
  await request(app)
    .post(`/api/v1/trades/${id}/coffee`)
    .send(input)
    .expect(401);
  await request(app)
    .post(`/api/v1/trades/${id}/coffee/${invitation}/respond`)
    .send({ action: 'accept' })
    .expect(401);
});

test('coffee input defaults the offer off and rejects forged identity/state', async () => {
  assert.equal(coffeeSendSchema.parse(input).offerToPay, false);
  for (const extra of [
    { inviterId: actor },
    { tradeId: id },
    { status: 'accepted' },
    { offerToPay: 'true' },
    { operationKey: undefined },
    { inviteeId: 'invalid' },
  ]) {
    await request(app)
      .post(`/api/v1/trades/${id}/coffee`)
      .set('Authorization', 'Bearer synthetic')
      .send({ ...input, ...extra })
      .expect(400);
  }
});

test('coffee responses validate only explicit actions and strict params/query', async () => {
  for (const action of ['accept', 'decline', 'cancel'])
    assert.equal(coffeeResponseSchema.safeParse({ action }).success, true);
  for (const body of [
    { action: 'join' },
    { action: 'accept', actorId: actor },
    { action: 'accept', offerToPay: true },
  ]) {
    await request(app)
      .post(`/api/v1/trades/${id}/coffee/${invitation}/respond`)
      .set('Authorization', 'Bearer synthetic')
      .send(body)
      .expect(400);
  }
  await request(app)
    .get(`/api/v1/trades/${id}/coffee/eligibility`)
    .set('Authorization', 'Bearer synthetic')
    .query({ inviteeId: input.inviteeId, inviterId: actor })
    .expect(400);
  await request(app)
    .post(`/api/v1/trades/${id}/coffee/invalid/respond`)
    .set('Authorization', 'Bearer synthetic')
    .send({ action: 'accept' })
    .expect(400);
});
