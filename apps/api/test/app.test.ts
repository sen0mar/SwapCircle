import assert from 'node:assert/strict';
import { test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { readEnvironment } from '../src/env.js';
import { apiErrorSchema } from '@swapcircle/contracts';

const app = createApp({ allowedOrigins: ['http://127.0.0.1:5173'] });

test('startup rejects missing/unsafe configuration without exposing values', () => {
  for (const config of [
    {},
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://user:secret@example.org' },
    { CORS_ORIGINS: 'https://example.org/path' },
    { CORS_ORIGINS: 'https://example.org', PORT: '0' },
  ]) {
    assert.throws(
      () =>
        readEnvironment({
          SUPABASE_URL: 'http://127.0.0.1:55431',
          SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
          SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
          DATABASE_URL:
            'postgresql://swapcircle_runtime:synthetic@127.0.0.1:55432/postgres',
          ...config,
        }),
      /^Error: Invalid server configuration: (CORS_ORIGINS|PORT)$/,
    );
  }

  assert.deepEqual(
    readEnvironment({
      SUPABASE_URL: 'http://127.0.0.1:55431',
      SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-server-key',
      DATABASE_URL:
        'postgresql://swapcircle_runtime:synthetic@127.0.0.1:55432/postgres',
      CORS_ORIGINS: 'http://127.0.0.1:5173, https://example.org',
    }),
    {
      limits: {
        allowance: 120,
        windowSeconds: 3600,
        burstMax: 60,
        burstWindowMs: 60000,
      },
      port: 3001,
      supabaseUrl: 'http://127.0.0.1:55431',
      supabasePublishableKey: 'test-public-key',
      supabaseServiceRoleKey: 'synthetic-server-key',
      databaseUrl:
        'postgresql://swapcircle_runtime:synthetic@127.0.0.1:55432/postgres',
      allowedOrigins: ['http://127.0.0.1:5173', 'https://example.org'],
    },
  );
});

test('liveness uses allowlisted CORS and generated request IDs, with Helmet headers', async () => {
  const allowed = await request(app)
    .get('/api/v1/live')
    .set({ Origin: 'http://127.0.0.1:5173', 'X-Request-Id': 'untrusted' })
    .expect(200);

  assert.deepEqual(allowed.body, { status: 'ok' });

  assert.equal(
    allowed.headers['access-control-allow-origin'],
    'http://127.0.0.1:5173',
  );

  assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
  assert.equal(allowed.headers['x-powered-by'], undefined);
  assert.ok(allowed.headers['x-request-id']);
  assert.match(allowed.headers['x-request-id'], /^[0-9a-f-]{36}$/);

  const denied = await request(app)
    .get('/api/v1/live')
    .set('Origin', 'https://evil.example')
    .expect(200);

  assert.equal(denied.headers['access-control-allow-origin'], undefined);

  assert.notEqual(
    allowed.headers['x-request-id'],
    denied.headers['x-request-id'],
  );

  const preflight = await request(app).options('/api/v1/live').set({
    Origin: 'http://127.0.0.1:5173',
    'Access-Control-Request-Method': 'GET',
  });

  assert.equal(preflight.status, 204);
});

test('malformed, oversized, unsupported and missing requests return safe envelopes', async () => {
  for (const [body, contentType, status, code] of [
    [
      '{"secret":"private-database-password",',
      'application/json',
      400,
      'INVALID_JSON',
    ],
    [
      JSON.stringify({ value: 'x'.repeat(17000) }),
      'application/json',
      413,
      'BODY_TOO_LARGE',
    ],
    ['{}', 'application/json; charset=invalid', 415, 'UNSUPPORTED_ENCODING'],
    ['{}', 'application/json', 404, 'NOT_FOUND'],
  ] as const) {
    const response = await request(app)
      .post('/api/v1/missing')
      .set('Content-Type', contentType)
      .send(body);

    assert.equal(response.status, status);

    const data = apiErrorSchema.parse(response.body);

    assert.equal(data.error.code, code);
    assert.equal(data.error.requestId, response.headers['x-request-id']);
    assert.deepEqual(Object.keys(data.error), ['code', 'message', 'requestId']);

    assert.doesNotMatch(
      JSON.stringify(data),
      /private-database-password|SyntaxError|stack/,
    );
  }
});
