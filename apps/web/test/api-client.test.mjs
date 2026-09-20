import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { livenessSchema } from '@swapcircle/contracts';
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
after(() => server.close());
const { apiRequest, ApiError } = await server.ssrLoadModule(
  '/src/lib/api-client.ts',
);

test('fetch wrapper validates success and preserves safe API error references', async (t) => {
  const requestId = 'c7f4f6b5-676e-4342-9a22-016e4ed0e438';
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Accept, 'application/json');
    assert.equal(options.credentials, 'omit');
    return globalThis.Response.json({ status: 'ok' });
  });
  assert.deepEqual(await apiRequest('/api/v1/live', livenessSchema), {
    status: 'ok',
  });
  fetch.mock.mockImplementation(async () =>
    globalThis.Response.json(
      { error: { code: 'INVALID_JSON', message: 'Invalid JSON.', requestId } },
      { status: 400 },
    ),
  );
  await assert.rejects(
    apiRequest('/api/v1/live', livenessSchema),
    (error) =>
      error instanceof ApiError &&
      error.code === 'INVALID_JSON' &&
      error.status === 400 &&
      error.requestId === requestId,
  );
});
test('network, unexpected payloads and non-JSON errors have safe consistent errors', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [implementation, code] of [
    [
      async () => {
        throw new Error('secret internal detail');
      },
      'NETWORK_ERROR',
    ],
    [
      async () => globalThis.Response.json({ status: 'fake' }),
      'INVALID_RESPONSE',
    ],
    [
      async () =>
        new globalThis.Response('secret stack trace', { status: 500 }),
      'HTTP_ERROR',
    ],
  ]) {
    fetch.mock.mockImplementation(implementation);
    await assert.rejects(
      apiRequest('/api/v1/live', livenessSchema),
      (error) => error.code === code && !error.message.includes('secret'),
    );
  }
});
test('caller cancellation is preserved and timeouts give recoverable errors', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  const controller = new globalThis.AbortController();
  const cancelled = apiRequest('/api/v1/live', livenessSchema, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(cancelled, (error) => error.name === 'AbortError');
  const keepAlive = globalThis.setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      apiRequest('/api/v1/live', livenessSchema, { timeoutMs: 10 }),
      (error) => error.code === 'TIMEOUT',
    );
  } finally {
    globalThis.clearTimeout(keepAlive);
  }
});
