import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import * as Sentry from '@sentry/react';
import { scrubEvent } from '../src/observability/privacy';
import {
  initializeMonitoring,
  reportReactError,
} from '../src/observability/sentry';

const secret =
  'private@example.org bearer-token exact-meeting-address private-message';
const revision = 'a'.repeat(40);

test('Sentry allowlist removes hostile payloads and preserves matching private map coordinates', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  const filename = 'https://public.example/assets/index-abc123.js';
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
      filename: 'app:///assets/index-abc123.js',
      lineno: 12,
      colno: 4,
      in_app: true,
    },
  ]);
  assert.deepEqual(event.debug_meta?.images, [
    {
      type: 'sourcemap',
      code_file: 'app:///assets/index-abc123.js',
      debug_id: id,
    },
  ]);
});

test('browser monitoring sends only scrubbed events with replay and sessions disabled', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@synthetic.example/1');
  const envelopes: unknown[] = [];

  initializeMonitoring(() => ({
    send: async (envelope) => {
      envelopes.push(envelope);
      return { statusCode: 200 };
    },
    flush: async () => true,
  }));
  const options = Sentry.getClient()?.getOptions() as
    Sentry.BrowserOptions | undefined;

  assert.equal(options?.defaultIntegrations, false);
  assert.equal(options?.traceLifecycle, 'static');
  assert.deepEqual(options?.tracePropagationTargets, []);
  assert.equal(options?.replaysSessionSampleRate, 0);
  assert.equal(options?.replaysOnErrorSampleRate, 0);
  assert.equal(options?.dataCollection?.httpHeaders, false);
  assert.deepEqual(options?.dataCollection?.httpBodies, []);
  assert.equal(options?.beforeSend, scrubEvent);
  assert.equal(options?.beforeBreadcrumb?.({ message: secret }), null);
  assert.deepEqual(
    Array.isArray(options?.integrations)
      ? options.integrations.map((integration) => integration.name)
      : [],
    ['GlobalHandlers'],
  );
  Sentry.setUser({ email: secret });
  Sentry.setExtra('private', secret);
  Sentry.addBreadcrumb({ message: secret });
  reportReactError(new Error(secret));
  await Sentry.flush(2000);

  assert.equal(envelopes.length, 1);
  assert.doesNotMatch(
    JSON.stringify(envelopes),
    /private@example|bearer-token|exact-meeting|private-message|replay_event|session|user|breadcrumbs/,
  );
  await Sentry.close(2000);
  vi.unstubAllEnvs();
});
