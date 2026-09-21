import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { createTokenVerifier } from '../src/auth/verify.js';
import { createApp } from '../src/app.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'application/json');

  response.end(
    JSON.stringify({
      keys: [
        {
          ...publicKey.export({ format: 'jwk' }),
          kid: 'test',
          alg: 'RS256',
          use: 'sig',
        },
      ],
    }),
  );
});

let url: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (!address || typeof address === 'string')
    throw new Error('Missing test port');

  url = `http://127.0.0.1:${address.port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

const userId = 'a8ded912-c170-4988-8750-9747558e8a87';

function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test' }),
  ).toString('base64url');

  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      iss: `${url}/auth/v1`,
      aud: 'authenticated',
      role: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 300,
      ...overrides,
    }),
  ).toString('base64url');

  const message = `${header}.${payload}`;

  return `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}`;
}

test('real SDK verifies signatures and identity claims; API derives identity only from subject', async () => {
  const app = createApp({
    allowedOrigins: [],
    verifyToken: createTokenVerifier(url, 'synthetic-public-key'),
  });

  const response = await request(app)
    .get('/api/v1/identity?userId=forged')
    .set('Authorization', `Bearer ${token()}`)
    .expect(200);

  expect(response.body).toEqual({ userId });
  expect(response.headers['cache-control']).toBe('no-store');

  const otherUserId = '3f248a50-2f0d-49ee-9882-b6a1e3fc1997';

  const otherUser = await request(app)
    .get('/api/v1/identity')
    .set('Authorization', `Bearer ${token({ sub: otherUserId })}`)
    .expect(200);

  expect(otherUser.body).toEqual({ userId: otherUserId });

  await request(app)
    .get('/api/v1/identity')
    .set('Authorization', `Bearer ${token({ aud: ['authenticated'] })}`)
    .expect(200);

  for (const invalid of [
    undefined,
    'Basic abc',
    'Bearer malformed',
    `Bearer ${token({ iss: 'https://other.invalid/auth/v1' })}`,
    `Bearer ${token({ aud: 'other' })}`,
    `Bearer ${token({ exp: 1 })}`,
    `Bearer ${token({ exp: undefined })}`,
    `Bearer ${token({ sub: undefined })}`,
    `Bearer ${token({ sub: 'forged' })}`,
    `Bearer ${token({ role: 'service_role' })}`,
    `Bearer ${token().slice(0, -15)}invalidsignature`,
  ]) {
    const call = request(app).get('/api/v1/identity');

    if (invalid) call.set('Authorization', invalid);

    const denied = await call.expect(401);

    expect(denied.body.error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(denied.body)).not.toContain('Bearer');
    expect(denied.headers['www-authenticate']).toBe('Bearer');
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(denied.body.error.requestId).toBe(denied.headers['x-request-id']);
    expect(denied.body.userId).toBeUndefined();
  }
});

test('authentication fails closed without a configured verifier while liveness stays public', async () => {
  const app = createApp({ allowedOrigins: [] });

  await request(app).get('/api/v1/live').expect(200, { status: 'ok' });

  const denied = await request(app)
    .get('/api/v1/identity')
    .set('Authorization', `Bearer ${token()}`)
    .expect(401);

  expect(denied.body.error.code).toBe('UNAUTHORIZED');
});

test('async authentication failures reach the safe error handler', async () => {
  const app = createApp({
    allowedOrigins: [],
    verifyToken: async () => {
      throw new Error('synthetic-private-verifier-detail');
    },
  });

  const response = await request(app)
    .get('/api/v1/identity')
    .set('Authorization', 'Bearer synthetic-token')
    .expect(500);

  expect(response.body).toEqual({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
      requestId: response.headers['x-request-id'],
    },
  });

  expect(response.headers['cache-control']).toBe('no-store');
});
