import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createGuestRouter } from '../src/features/development/guest.routes.js';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithPassword: signIn } }),
}));
const config = {
  environment: 'development',
  authUrl: 'http://127.0.0.1:55431',
  databaseUrl:
    'postgres://swapcircle_runtime:synthetic@127.0.0.1:55432/postgres',
  publishableKey: 'synthetic-public-key',
  allowedOrigins: ['http://127.0.0.1:5173'],
};
const id = '12345678-1234-4234-8234-123456789012';
afterEach(() => vi.clearAllMocks());

test('production app has no guest route and refuses hosted guest construction', async () => {
  expect(
    (
      await request(createApp({ allowedOrigins: config.allowedOrigins })).post(
        '/api/v1/auth/guest',
      )
    ).status,
  ).toBe(404);
  expect(() =>
    createGuestRouter({ ...config, environment: 'production' }),
  ).toThrow();
  expect(() =>
    createGuestRouter({ ...config, authUrl: 'https://hosted.supabase.co' }),
  ).toThrow();
});

test('guest login requires seed readiness, allowed Origin and matching seeded identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swapcircle-guest-'));
  const path = pathToFileURL(join(directory, 'credentials.json'));
  const app = createApp({
    allowedOrigins: config.allowedOrigins,
    guestRouter: createGuestRouter(config, path),
  });
  const login = () =>
    request(app)
      .post('/api/v1/auth/guest')
      .set('Origin', config.allowedOrigins[0]!);
  try {
    expect((await login()).status).toBe(503);
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        authUrl: config.authUrl,
        accounts: [
          {
            key: 'guest',
            id,
            email: 'synthetic@example.invalid',
            password: 'a-strong-synthetic-password',
          },
        ],
      }),
    );
    expect((await login()).status).toBe(503);
    await writeFile(
      new URL('ready.json', path),
      JSON.stringify({ version: 1, guestId: id }),
    );
    expect(
      (
        await request(app)
          .post('/api/v1/auth/guest')
          .set('Origin', 'https://unapproved.invalid')
      ).status,
    ).toBe(403);
    expect(signIn).not.toHaveBeenCalled();
    signIn.mockResolvedValue({
      error: null,
      data: {
        session: {
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
        },
        user: { id: 'different', app_metadata: { demo_seed: 'swapcircle-v1' } },
      },
    });
    const mismatch = await login();
    expect(mismatch.status).toBe(503);
    expect(JSON.stringify(mismatch.body)).not.toContain('synthetic-access');
    signIn.mockResolvedValue({
      error: null,
      data: {
        session: {
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
        },
        user: { id, app_metadata: { demo_seed: 'swapcircle-v1' } },
      },
    });
    const success = await login();
    expect(success.status).toBe(200);
    expect(success.headers['cache-control']).toBe('no-store');
    expect(success.body).toEqual({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-refresh',
    });
    expect(JSON.stringify(success.body)).not.toContain('password');
    signIn.mockRejectedValue(new Error('sensitive-provider-detail'));
    expect(JSON.stringify((await login()).body)).not.toContain(
      'sensitive-provider-detail',
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('guest session requests are rate limited without bypassing authentication', async () => {
  const app = createApp({
    allowedOrigins: config.allowedOrigins,
    guestRouter: createGuestRouter(
      config,
      pathToFileURL('/nonexistent/credentials.json'),
    ),
  });
  for (let i = 0; i < 10; i++)
    expect(
      (
        await request(app)
          .post('/api/v1/auth/guest')
          .set('Origin', config.allowedOrigins[0]!)
      ).status,
    ).toBe(503);
  expect(
    (
      await request(app)
        .post('/api/v1/auth/guest')
        .set('Origin', config.allowedOrigins[0]!)
    ).status,
  ).toBe(429);
  expect(signIn).not.toHaveBeenCalled();
});

test('hosted guest requires explicit server credentials, exact origin and completed synthetic identity', async () => {
  const hostedConfig = {
    environment: 'production',
    authUrl: 'https://tpanyqfgmbpsiejqjocd.supabase.co',
    databaseUrl:
      'postgres://swapcircle_runtime.tpanyqfgmbpsiejqjocd:synthetic@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    publishableKey: 'synthetic-public-key',
    allowedOrigins: ['https://swapcircle.pages.dev'],
    hostedCredentials: JSON.stringify({
      id,
      email: 'swapcircle-demo-prod-guest@example.invalid',
      password: 'a-strong-synthetic-password',
    }),
  };
  expect(() =>
    createGuestRouter({ ...hostedConfig, hostedCredentials: undefined }),
  ).toThrow();
  expect(() =>
    createGuestRouter({
      ...hostedConfig,
      allowedOrigins: ['https://unapproved.invalid'],
    }),
  ).toThrow();
  const app = createApp({
    allowedOrigins: hostedConfig.allowedOrigins,
    guestRouter: createGuestRouter(hostedConfig),
  });
  const login = () =>
    request(app)
      .post('/api/v1/auth/guest')
      .set('Origin', hostedConfig.allowedOrigins[0]!);
  const user = {
    id,
    app_metadata: {
      demo_seed: 'swapcircle-v1',
      demo_target: hostedConfig.authUrl,
      demo_ready: false,
    },
  };
  signIn.mockResolvedValue({
    error: null,
    data: {
      user,
      session: {
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
      },
    },
  });
  expect((await login()).status).toBe(503);
  user.app_metadata.demo_ready = true;
  const result = await login();
  expect(result.status).toBe(200);
  expect(result.headers['cache-control']).toBe('no-store');
  expect(JSON.stringify(result.body)).not.toContain('password');
  user.app_metadata.demo_target = 'http://127.0.0.1:55431';
  expect((await login()).status).toBe(503);
});
