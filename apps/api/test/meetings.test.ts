import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { Pool } from 'pg';
import {
  meetingCreateSchema,
  meetingResponseSchema,
} from '@swapcircle/contracts';
import { createApp } from '../src/app.js';
import { MeetingsService } from '../src/features/meetings/meetings.service.js';
import { MeetingsRepository } from '../src/features/meetings/meetings.repository.js';

const input = {
  operationKey: randomUUID(),
  expectedTradeVersion: 1,
  place: 'Synthetic public square',
  mapLink: null,
  meetingAt: '2026-10-25T00:30:00.000Z',
  timeZone: 'Europe/Paris',
};
const id = randomUUID();
const app = createApp({
  allowedOrigins: [],
  verifyToken: async () => randomUUID(),
  meetings: new MeetingsService(new MeetingsRepository(new Pool())),
});

test('meeting inputs require an exact valid instant and actual IANA zone', () => {
  for (const meetingAt of [
    '2026-02-30T12:00:00.000Z',
    '2026-10-25T02:30:00',
    '2026-10-25T02:30:00.000+02:00',
    '2026-10-25',
    'invalid',
    '0000-01-01T00:00:00.000Z',
  ])
    assert.equal(
      meetingCreateSchema.safeParse({ ...input, meetingAt }).success,
      false,
    );
  for (const timeZone of [
    'Europe/Imaginary',
    '+02:00',
    'CET',
    '',
    ' Europe/Paris',
  ])
    assert.equal(
      meetingCreateSchema.safeParse({ ...input, timeZone }).success,
      false,
    );
  for (const timeZone of [
    'Europe/Paris',
    'America/New_York',
    'UTC',
    'Asia/Kathmandu',
  ])
    assert.equal(
      meetingCreateSchema.safeParse({ ...input, timeZone }).success,
      true,
    );
});

test('meeting location supports text or an optional safe map link', () => {
  assert.equal(
    meetingCreateSchema.parse({ ...input, mapLink: undefined }).mapLink,
    null,
  );
  assert.equal(
    meetingCreateSchema.safeParse({
      ...input,
      place: undefined,
      mapLink: 'https://maps.example.com/square',
    }).success,
    true,
  );
  assert.equal(
    meetingCreateSchema.safeParse({ ...input, place: null, mapLink: null })
      .success,
    false,
  );
});

test('DST repeated hours identify two distinct instants; spring gaps are never guessed', () => {
  const display = (instant: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(instant));
  for (const meetingAt of [
    '2026-10-25T00:30:00.000Z',
    '2026-10-25T01:30:00.000Z',
  ]) {
    assert.equal(
      meetingCreateSchema.parse({ ...input, meetingAt }).meetingAt,
      meetingAt,
    );
    assert.equal(display(meetingAt), '02:30');
  }
  assert.equal(display('2026-03-29T00:30:00.000Z'), '01:30');
  assert.equal(display('2026-03-29T01:30:00.000Z'), '03:30');
  assert.equal(
    meetingCreateSchema.safeParse({
      ...input,
      meetingAt: '2026-03-29T02:30:00',
    }).success,
    false,
  );
});

test('meeting boundary rejects forged identity, unsafe links, state and coercions', async () => {
  for (const extra of [
    { actorId: id },
    { revision: 1 },
    { place: ' ' },
    { expectedTradeVersion: '1' },
    { mapLink: 'javascript:alert(1)' },
    { mapLink: 'http://example.com' },
    { mapLink: 'https://user:pass@example.com' },
    { meetingAt: '2026-02-30T12:00:00.000Z' },
    { timeZone: 'Europe/Imaginary' },
  ])
    await request(app)
      .post(`/api/v1/trades/${id}/meeting`)
      .set('Authorization', 'Bearer synthetic')
      .send({ ...input, ...extra })
      .expect(400);
  assert.equal(
    meetingCreateSchema.safeParse({
      ...input,
      mapLink: 'https://maps.example.com/?q=Square',
    }).success,
    true,
  );
  assert.equal(
    meetingResponseSchema.safeParse({
      operationKey: id,
      expectedRevision: 1,
      expectedTradeVersion: 1,
      expectedResponse: null,
      response: 'confirmed',
      userId: id,
    }).success,
    false,
  );
});

test('all meeting endpoints authenticate before reads and writes', async () => {
  await request(app).get(`/api/v1/meetups/${id}`).expect(401);
  await request(app).get(`/api/v1/trades/${id}/meeting`).expect(401);
  await request(app)
    .post(`/api/v1/trades/${id}/meeting`)
    .send(input)
    .expect(401);
  await request(app)
    .put(`/api/v1/trades/${id}/meeting`)
    .send(input)
    .expect(401);
  await request(app)
    .post(`/api/v1/trades/${id}/meeting/respond`)
    .send({ response: 'confirmed' })
    .expect(401);
});
