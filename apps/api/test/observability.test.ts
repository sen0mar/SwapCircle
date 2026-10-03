import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/observability/logger.js';
import { HealthRepository } from '../src/features/health/health.repository.js';
import { HealthService } from '../src/features/health/health.service.js';
import { scrubEvent } from '../src/observability/privacy.js';
import { readinessSchema } from '@swapcircle/contracts';
import type { Pool } from 'pg';

const secret =
  'private@example.org bearer-token exact-meeting-address private-message';
const revision = 'a'.repeat(40);

test('synthetic failure logs only templates, generated references and safe metadata', async () => {
  let output = '';
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  );
  const app = createApp({
    allowedOrigins: [],
    logger,
    verifyToken: async () => {
      throw new Error(secret);
    },
  });
  const response = await request(app)
    .get('/api/v1/identity?email=private@example.org')
    .set({
      Authorization: 'Bearer bearer-token',
      Cookie: 'session=bearer-token',
      'X-Request-Id': secret,
    })
    .expect(500);
  await request(app)
    .post(`/api/v1/${encodeURIComponent(secret)}`)
    .send({ message: secret })
    .expect(404);
  await request(app)
    .post('/api/v1/missing')
    .set('Content-Type', 'application/json')
    .send(`{"secret":"${secret}`)
    .expect(400);

  assert.doesNotMatch(
    output + JSON.stringify(response.body),
    /private@example|bearer-token|exact-meeting|private-message|Error:|stack|headers|cookie|query/i,
  );
  const logs = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(logs[0].route, '/api/v1/identity');
  assert.equal(logs[0].statusCode, 500);
  assert.equal(logs[0].errorCode, 'INTERNAL_ERROR');
  assert.equal(logs[0].reqId, response.headers['x-request-id']);
  assert.equal(typeof logs[0].responseTime, 'number');
  assert.equal(logs[1].route, 'unmatched');
});

test('readiness reflects dependency failure separately from liveness and bounds exhausted pools', async () => {
  for (const [query, expected] of [
    [async () => ({ rows: [{ '?column?': 1 }] }), 'ready'],
    [
      async () => {
        throw new Error(secret);
      },
      'unavailable',
    ],
    [() => new Promise(() => {}), 'unavailable'],
  ] as const) {
    const app = createApp({
      allowedOrigins: [],
      health: new HealthService(
        new HealthRepository({ query } as unknown as Pick<Pool, 'query'>),
        revision,
        20,
      ),
    });
    const result = await request(app)
      .get('/api/v1/ready')
      .expect(expected === 'ready' ? 200 : 503);

    assert.deepEqual(readinessSchema.parse(result.body), {
      status: expected,
      revision,
    });
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private@example|bearer-token/,
    );
    await request(app).get('/api/v1/live').expect(200, { status: 'ok' });
  }
  const unavailable = createApp({ allowedOrigins: [] });
  await request(unavailable)
    .get('/api/v1/ready')
    .expect(503, { status: 'unavailable', revision: 'unknown' });
});

test('Sentry allowlist removes hostile payloads and preserves matching private map coordinates', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  const filename =
    'file:///private/host/apps/api/dist/features/trades/trades.service.js';
  const event = scrubEvent({
    type: undefined,
    event_id: 'a'.repeat(32),
    release: revision,
    message: secret,
    user: { email: secret, ip_address: secret },
    request: { url: secret, headers: { Authorization: secret }, data: secret },
    extra: { secret },
    breadcrumbs: [{ message: secret }],
    contexts: {
      trace: {
        span_id: 'a'.repeat(16),
        trace_id: 'a'.repeat(32),
        data: { secret },
      },
    },
    server_name: secret,
    tags: { request_id: id, private: secret },
    debug_meta: {
      images: [{ type: 'sourcemap', code_file: filename, debug_id: id }],
    },
    exception: {
      values: [
        {
          type: secret,
          value: secret,
          stacktrace: {
            frames: [
              {
                filename,
                lineno: 12,
                colno: 4,
                function: secret,
                vars: { secret },
                context_line: secret,
              },
              { filename: `https://example.org/${secret}`, function: secret },
            ],
          },
        },
      ],
    },
  });

  assert.doesNotMatch(
    JSON.stringify(event),
    /private@example|bearer-token|exact-meeting|private-message|private\/host/,
  );
  assert.equal(event.tags?.request_id, id);
  assert.deepEqual(event.exception?.values?.[0]?.stacktrace?.frames, [
    {
      filename: 'app:///features/trades/trades.service.js',
      lineno: 12,
      colno: 4,
      in_app: true,
    },
  ]);
  assert.deepEqual(event.debug_meta?.images, [
    {
      type: 'sourcemap',
      code_file: 'app:///features/trades/trades.service.js',
      debug_id: id,
    },
  ]);
});

test('API SDK emits scrubbed envelopes with the same log and response reference', async () => {
  const Sentry = await import('@sentry/node');
  const { initializeMonitoring } =
    await import('../src/observability/sentry.js');
  const envelopes: unknown[] = [];
  let output = '';
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  );

  initializeMonitoring('https://public@synthetic.example/1', revision, () => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  }));
  Sentry.setUser({ email: secret });
  Sentry.setExtra('private', secret);
  const app = createApp({
    allowedOrigins: [],
    logger,
    verifyToken: async () => {
      throw new Error(secret);
    },
  });
  const response = await request(app)
    .get('/api/v1/identity')
    .set('Authorization', 'Bearer synthetic')
    .expect(500);
  await Sentry.flush(2000);

  assert.equal(envelopes.length, 1);
  assert.doesNotMatch(
    JSON.stringify(envelopes) + output,
    /private@example|bearer-token|exact-meeting|private-message|user|headers|breadcrumbs/,
  );
  const envelope = envelopes[0] as [
    { event_id: string },
    [[unknown, { tags: { request_id: string } }]],
  ];
  const log = JSON.parse(output.trim());

  assert.equal(
    envelope[1][0][1].tags.request_id,
    response.headers['x-request-id'],
  );
  assert.equal(envelope[0].event_id, log.eventId);
  assert.equal(log.reqId, response.body.error.requestId);
  await Sentry.close(2000);
});

test('route parameters and started-response errors never reach raw fallback logging', async () => {
  const { default: express } = await import('express');
  const { requestId } = await import('../src/middleware/request-id.js');
  const { requestLogging } = await import('../src/observability/logger.js');
  const { errorHandler } = await import('../src/middleware/error-handler.js');
  let output = '';
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, callback) {
        output += chunk;
        callback();
      },
    }),
  );
  const app = express();
  const router = express.Router();

  app.use(requestId, requestLogging(logger));
  router.get('/members/:id', (_request, response) => response.sendStatus(204));
  router.get('/started', (_request, response, next) => {
    response.write('started');
    next(new Error(secret));
  });
  app.use('/api/v1', router);
  app.use(errorHandler);
  await request(app)
    .get('/api/v1/members/private@example.org?message=private-message')
    .expect(204);
  await assert.rejects(request(app).get('/api/v1/started'));

  const logs = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.equal(logs[0].route, '/api/v1/members/:id');
  assert.doesNotMatch(
    output,
    /private@example|bearer-token|exact-meeting|private-message|stack/,
  );
  // The original error must never reach Express's stderr-writing final handler.
  let forwarded = false;
  let destroyed = false;
  errorHandler(
    new Error(secret),
    {} as import('express').Request,
    {
      headersSent: true,
      locals: {},
      getHeader: () => undefined,
      destroy: () => {
        destroyed = true;
      },
    } as unknown as import('express').Response,
    () => {
      forwarded = true;
    },
  );
  assert.equal(destroyed, true);
  assert.equal(forwarded, false);
});

test('fatal exceptions and rejections exit with safe references, even without a DSN', async () => {
  const { mkdtemp, readFile, writeFile, rm, mkdir } =
    await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const temporaryRoot = resolve('test-results');

  await mkdir(temporaryRoot, { recursive: true });
  const directory = await mkdtemp(`${temporaryRoot}/fatal-`);
  const source = await readFile(
    new URL('../src/observability/sentry.ts', import.meta.url),
    'utf8',
  );
  const file = `${directory}/sentry.ts`;
  const privacy = new URL('../src/observability/privacy.ts', import.meta.url)
    .href;

  await writeFile(
    file,
    source.replace("'./privacy.js'", JSON.stringify(privacy)),
  );
  try {
    for (const failure of [
      'throw new Error(marker)',
      'Promise.reject(new Error(marker))',
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
        import { installFatalErrorHandlers } from ${JSON.stringify(pathToFileURL(file).href)};
        installFatalErrorHandlers();
        const marker = ${JSON.stringify(secret)};
        ${failure};
      `,
        ],
        { encoding: 'utf8', timeout: 5000 },
      );

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /Fatal application error; reference [a-f0-9-]{36}/,
      );
      assert.doesNotMatch(
        result.stderr + result.stdout,
        /private@example|bearer-token|exact-meeting|private-message|Error:|stack/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a refused real database connection returns unavailable without leaking credentials', async () => {
  const { Pool } = await import('pg');
  const { createServer } = await import('node:net');
  const socket = createServer().listen(0, '127.0.0.1');

  await new Promise<void>((done) => socket.once('listening', done));
  const address = socket.address() as import('node:net').AddressInfo;

  await new Promise<void>((done) => socket.close(() => done()));
  const pool = new Pool({
    host: '127.0.0.1',
    port: address.port,
    user: 'synthetic',
    password: secret,
    connectionTimeoutMillis: 100,
  });
  try {
    const app = createApp({
      allowedOrigins: [],
      health: new HealthService(new HealthRepository(pool), revision),
    });
    const response = await request(app).get('/api/v1/ready').expect(503);

    assert.deepEqual(response.body, { status: 'unavailable', revision });
    await request(app).get('/api/v1/live').expect(200);
  } finally {
    await pool.end();
  }
});
