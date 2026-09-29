import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { test } from 'vitest';
import {
  apiErrorSchema,
  notificationCreationSchema,
} from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { NotificationsRepository } from '../src/features/notifications/notifications.repository.js';
import { NotificationsService } from '../src/features/notifications/notifications.service.js';

const actor = randomUUID();
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => actor,
  notifications: new NotificationsService(
    new NotificationsRepository(new Pool()),
  ),
  limits: {
    allowance: 120,
    windowSeconds: 3600,
    burstMax: 500,
    burstWindowMs: 60000,
  },
});

test('notification acknowledgments authenticate and validate bounded exact IDs before persistence', async () => {
  for (const [path, valid, invalid] of [
    [
      '/api/v1/notifications/read',
      { notification_id: randomUUID() },
      [
        {},
        { notification_id: 'invalid' },
        { notification_id: randomUUID(), recipient_id: actor },
      ],
    ],
    [
      '/api/v1/notifications/read-all',
      { notification_ids: [randomUUID()] },
      [
        {},
        { notification_ids: [] },
        { notification_ids: [actor, actor.toUpperCase()] },
        { notification_ids: Array.from({ length: 101 }, () => randomUUID()) },
        { notification_ids: ['invalid'] },
        { notification_ids: [actor], recipient_id: actor },
        { before: new Date().toISOString() },
      ],
    ],
  ] as const) {
    await request(app).put(path).send(valid).expect(401);

    for (const input of invalid) {
      const result = await request(app)
        .put(path)
        .set('Authorization', 'Bearer synthetic')
        .send(input)
        .expect(400);
      apiErrorSchema.parse(result.body);
    }
  }
});

test('notification reads and arbitrary creation have no Express endpoints', async () => {
  await request(app)
    .get('/api/v1/notifications')
    .set('Authorization', 'Bearer synthetic')
    .expect(404);
  await request(app)
    .post('/api/v1/notifications')
    .set('Authorization', 'Bearer synthetic')
    .send({ recipient_id: actor })
    .expect(404);
});

test('notification types and resource pairing exclude messages and private payloads', () => {
  const input = {
    recipient_id: actor,
    domain_event_id: randomUUID(),
    resource_id: randomUUID(),
    event_type: 'trade_invitation',
    resource_type: 'trade',
  };

  notificationCreationSchema.parse(input);

  for (const invalid of [
    { ...input, event_type: 'message' },
    { ...input, resource_type: 'conversation' },
    { ...input, body: 'Private synthetic text' },
    { ...input, meeting_location: 'Synthetic location' },
  ]) {
    if (notificationCreationSchema.safeParse(invalid).success)
      throw new Error('Invalid notification accepted');
  }
});
