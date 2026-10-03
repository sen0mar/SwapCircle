import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname } from 'node:path';
import { Writable } from 'node:stream';
import { createApp } from '../apps/api/dist/app.js';
import { createLogger } from '../apps/api/dist/observability/logger.js';
import { initializeMonitoring } from '../apps/api/dist/observability/sentry.js';

// Explicit, controlled hosted telemetry verification; never starts the real API
// or accesses a hosted database, Auth account, Storage object or user data.
assert.equal(
  process.env.VERIFY_HOSTED_MONITORING,
  '1',
  'Explicit synthetic monitoring verification required.',
);
assert.match(process.env.BUILD_REVISION ?? '', /^[a-f0-9]{40}$/);
const apiRequire = createRequire(
  new URL('../apps/api/package.json', import.meta.url),
);
const webRequire = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
const Sentry = apiRequire('@sentry/node');
const { chromium } = webRequire('@playwright/test');
const marker =
  'synthetic-private@example.invalid exact-meeting-marker private-message-marker';
const references = [];
let apiLog = '';
const logger = createLogger(
  new Writable({
    write(chunk, _encoding, callback) {
      apiLog += chunk;
      callback();
    },
  }),
);

function inspect(envelope) {
  const text =
    typeof envelope === 'string' ? envelope : JSON.stringify(envelope);

  assert.ok(!text.includes(marker));
  for (const value of [
    'synthetic-private@example.invalid',
    'exact-meeting-marker',
    'private-message-marker',
    'synthetic-bearer-token',
  ]) {
    assert.ok(!text.includes(value), 'Private marker leaked into telemetry.');
  }
}

async function checkStored(component, project, eventId) {
  const url = `https://sentry.io/api/0/projects/${encodeURIComponent(process.env.SENTRY_ORG)}/${encodeURIComponent(project)}/events/${eventId}/`;
  let response;
  const deadline = Date.now() + 30000;

  do {
    response = await globalThis.fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` },
      signal: globalThis.AbortSignal.timeout(10000),
    });
    if (response.status !== 404) break;
    await delay(2000);
  } while (Date.now() < deadline);

  if (response.status === 403) {
    console.info(
      `${component}: server event inspection requires project:read; ingestion acceptance is verified separately.`,
    );
    return false;
  }
  assert.equal(response.status, 200, 'Sentry event retrieval did not succeed.');
  const event = await response.json();

  inspect(event);
  assert.equal(event.eventID, eventId);
  assert.ok(
    !event.errors?.length,
    'Sentry reported event/source-map processing errors.',
  );
  const frames =
    event.entries
      ?.filter((entry) => entry.type === 'exception')
      .flatMap(
        (entry) =>
          entry.data.values?.flatMap(
            (value) => value.stacktrace?.frames ?? [],
          ) ?? [],
      ) ?? [];
  const expected =
    component === 'API' ? /middleware\/authenticate\.ts$/ : /src\/main\.tsx$/;

  assert.ok(
    frames.some(
      (frame) =>
        expected.test(frame.filename ?? '') &&
        Number.isSafeInteger(frame.lineNo),
    ),
    'Stored event lacks a resolved original application source coordinate.',
  );
  console.info(
    `${component}: stored event resolves to the expected original TypeScript source.`,
  );
  return true;
}

initializeMonitoring(process.env.SENTRY_DSN, process.env.BUILD_REVISION);
let apiEvent;
let apiStatus;
Sentry.getClient().on('beforeEnvelope', (envelope) => {
  inspect(envelope);
  apiEvent = envelope[1][0][1];
});
Sentry.getClient().on('afterSendEvent', (_event, response) => {
  apiStatus = response.statusCode;
});
const api = createApp({
  allowedOrigins: [],
  logger,
  verifyToken: async () => {
    throw new Error(marker);
  },
}).listen(0, '127.0.0.1');
await new Promise((done) => api.once('listening', done));
try {
  const response = await globalThis.fetch(
    `http://127.0.0.1:${api.address().port}/api/v1/identity?message=${encodeURIComponent(marker)}`,
    {
      headers: {
        Authorization: 'Bearer synthetic-bearer-token',
        Cookie: 'private-message-marker',
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.ok(await Sentry.flush(10000));
  assert.equal(
    apiStatus,
    200,
    'Sentry API ingestion did not accept the envelope.',
  );
  assert.equal(apiEvent.tags.request_id, body.error.requestId);
  assert.ok(
    apiEvent.exception.values[0].stacktrace.frames.some(
      (frame) => frame.filename === 'app:///middleware/authenticate.js',
    ),
  );
  inspect(apiLog);
  assert.ok(apiLog.includes(apiEvent.event_id));
  references.push({
    component: 'API',
    eventId: apiEvent.event_id,
    requestId: body.error.requestId,
    accepted: true,
  });
  console.info(
    `API: accepted synthetic event ${apiEvent.event_id}; correlated request ${body.error.requestId}.`,
  );
} finally {
  await Sentry.close(2000);
  await new Promise((done) => api.close(done));
}

const root = resolve('apps/web/dist');
const web = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);

    if (!file.startsWith(`${root}/`) || file.endsWith('.map')) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      'Content-Type',
      extname(file) === '.js'
        ? 'text/javascript'
        : extname(file) === '.css'
          ? 'text/css'
          : 'text/html',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
}).listen(0, '127.0.0.1');
await new Promise((done) => web.once('listening', done));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let accepted;
  const received = new Promise((done) => {
    accepted = done;
  });

  await page.route('**/envelope/**', async (route) => {
    const payload = route.request().postData();

    inspect(payload);
    const lines = payload.split('\n');
    const event = JSON.parse(lines[2]);
    const response = await route.fetch();

    assert.equal(
      response.status(),
      200,
      'Sentry web ingestion did not accept the envelope.',
    );
    assert.ok(
      event.exception.values[0].stacktrace.frames.some((frame) =>
        /^app:\/\/\/assets\/.+\.js$/.test(frame.filename),
      ),
    );
    assert.ok(
      event.debug_meta.images.length,
      'Browser debug IDs did not survive scrubbing.',
    );
    references.push({
      component: 'web',
      eventId: event.event_id,
      accepted: true,
    });
    console.info(
      `Web: accepted synthetic event ${event.event_id}; private map coordinates and debug IDs retained.`,
    );
    await route.fulfill({ response });
    accepted();
  });
  await page.addInitScript((value) => {
    const original = globalThis.document.getElementById.bind(
      globalThis.document,
    );

    globalThis.document.getElementById = (id) => {
      if (id === 'root') throw new Error(value);
      return original(id);
    };
  }, marker);
  await page.goto(
    `http://127.0.0.1:${web.address().port}/?private=${encodeURIComponent(marker)}`,
  );
  await Promise.race([
    received,
    new Promise((_done, reject) =>
      setTimeout(
        () => reject(new Error('Synthetic browser ingestion timed out.')),
        15000,
      ).unref(),
    ),
  ]);
} finally {
  await browser.close();
  await new Promise((done) => web.close(done));
}

let stored = true;
for (const { component, eventId } of references) {
  stored =
    (await checkStored(
      component,
      process.env[
        component === 'API' ? 'SENTRY_API_PROJECT' : 'SENTRY_WEB_PROJECT'
      ],
      eventId,
    )) && stored;
}
if (!stored) process.exitCode = 2;
