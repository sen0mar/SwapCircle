import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createApp } from '../dist/app.js';
import { readEnvironment } from '../dist/env.js';
import { apiErrorSchema } from '@swapcircle/contracts';

async function withServer(run) {
  const server = createApp({
    allowedOrigins: ['http://127.0.0.1:5173'],
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
test('startup rejects missing/unsafe configuration without exposing values', () => {
  for (const config of [
    {},
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://user:secret@example.org' },
    { CORS_ORIGINS: 'https://example.org/path' },
    { CORS_ORIGINS: 'https://example.org', PORT: '0' },
  ]) {
    assert.throws(
      () => readEnvironment(config),
      /^Error: Invalid server configuration: (CORS_ORIGINS|PORT)$/,
    );
  }
  assert.deepEqual(
    readEnvironment({
      CORS_ORIGINS: 'http://127.0.0.1:5173, https://example.org',
    }),
    {
      port: 3001,
      allowedOrigins: ['http://127.0.0.1:5173', 'https://example.org'],
    },
  );
});
test('liveness uses allowlisted CORS and generated request IDs, with Helmet headers', () =>
  withServer(async (url) => {
    const allowed = await globalThis.fetch(`${url}/api/v1/live`, {
      headers: { Origin: 'http://127.0.0.1:5173', 'X-Request-Id': 'untrusted' },
    });
    assert.deepEqual(await allowed.json(), { status: 'ok' });
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'http://127.0.0.1:5173',
    );
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(allowed.headers.get('x-powered-by'), null);
    assert.match(allowed.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    const denied = await globalThis.fetch(`${url}/api/v1/live`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.notEqual(
      allowed.headers.get('x-request-id'),
      denied.headers.get('x-request-id'),
    );
    const preflight = await globalThis.fetch(`${url}/api/v1/live`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.equal(preflight.status, 204);
  }));
test('malformed, oversized, unsupported and missing requests return safe envelopes', () =>
  withServer(async (url) => {
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
    ]) {
      const response = await globalThis.fetch(`${url}/api/v1/missing`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
      assert.equal(response.status, status);
      const data = apiErrorSchema.parse(await response.json());
      assert.equal(data.error.code, code);
      assert.equal(data.error.requestId, response.headers.get('x-request-id'));
      assert.deepEqual(Object.keys(data.error), [
        'code',
        'message',
        'requestId',
      ]);
      assert.doesNotMatch(
        JSON.stringify(data),
        /private-database-password|SyntaxError|stack/,
      );
    }
  }));
