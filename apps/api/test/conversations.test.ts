import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { test } from 'vitest';
import { apiErrorSchema } from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { ConversationsRepository } from '../src/features/conversations/conversations.repository.js';
import { ConversationsService } from '../src/features/conversations/conversations.service.js';

const actor = randomUUID();
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => actor,
  conversations: new ConversationsService(
    new ConversationsRepository(new Pool()),
  ),
});

const path = '/api/v1/conversations/direct';

test('starting a conversation authenticates and rejects forged identity and invalid targets before persistence', async () => {
  await request(app).post(path).send({ userId: randomUUID() }).expect(401);

  for (const input of [
    { userId: 'invalid' },
    { userId: randomUUID(), senderId: randomUUID() },
    { userId: randomUUID(), type: 'group' },
    { userId: actor },
    { userId: actor.toUpperCase() },
    {},
  ]) {
    const response = await request(app)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .send(input)
      .expect(400);
    apiErrorSchema.parse(response.body);
    assert.ok(!JSON.stringify(response.body).includes(actor));
  }
});

test('history, membership management and group creation have no Express bypass routes', async () => {
  for (const path of [
    '/api/v1/conversations',
    `/api/v1/conversations/${randomUUID()}`,
    '/api/v1/messages',
    '/api/v1/conversation_members',
  ]) {
    await request(app)
      .get(path)
      .set('Authorization', 'Bearer synthetic')
      .expect(404);
    await request(app)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .send({ userId: actor })
      .expect(404);
  }
});

test('message submission rejects invalid content, references and forged identity before persistence', async () => {
  const input = {
    conversation_id: randomUUID(),
    body: 'Synthetic message',
    client_message_id: randomUUID(),
  };
  const path = '/api/v1/conversations/messages';

  await request(app).post(path).send(input).expect(401);

  for (const invalid of [
    {},
    { ...input, sender_id: actor },
    { ...input, senderId: actor },
    { ...input, conversation_id: 'invalid' },
    { ...input, client_message_id: 'invalid' },
    { ...input, body: '' },
    { ...input, body: ' \n\t' },
    { ...input, body: 'x'.repeat(5001) },
    { ...input, body: 123 },
  ]) {
    const result = await request(app)
      .post(path)
      .set('Authorization', 'Bearer synthetic')
      .send(invalid)
      .expect(400);
    apiErrorSchema.parse(result.body);
    assert.equal(result.body.error.code, 'INVALID_INPUT');
  }
});
