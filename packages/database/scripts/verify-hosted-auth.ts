import assert from 'node:assert/strict';
import { hostedOrigin, hostedRef } from './hosted-target.ts';

export async function verifyHostedPublicAccess(
  environment: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
) {
  assert.ok(environment.SUPABASE_PUBLISHABLE_KEY);
  const headers = {
    apikey: environment.SUPABASE_PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
  };

  for (const table of ['profiles', 'messages', 'notifications']) {
    for (const method of ['GET', 'POST']) {
      const response = await transport(
        `${environment.SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`,
        {
          method,
          headers,
          ...(method === 'POST' ? { body: '{}' } : {}),
          signal: AbortSignal.timeout(15_000),
        },
      );
      assert.ok(
        [401, 403].includes(response.status),
        'Anonymous application access must be denied.',
      );
      const error = (await response.json()) as { code?: string };
      assert.equal(error.code, '42501');
    }
  }

  const authorize = new URL(`${environment.SUPABASE_URL}/auth/v1/authorize`);
  authorize.searchParams.set('provider', 'google');
  authorize.searchParams.set('redirect_to', `${hostedOrigin}/auth/callback`);
  authorize.searchParams.set('code_challenge', 'A'.repeat(43));
  authorize.searchParams.set('code_challenge_method', 's256');
  const response = await transport(authorize, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });

  assert.equal(response.status, 302);
  const google = new URL(response.headers.get('location')!);
  assert.equal(google.origin, 'https://accounts.google.com');
  assert.equal(
    google.searchParams.get('client_id'),
    environment.GOOGLE_CLIENT_ID,
  );
  assert.equal(
    google.searchParams.get('redirect_uri'),
    `https://${hostedRef}.supabase.co/auth/v1/callback`,
  );
  assert.equal(google.searchParams.get('response_type'), 'code');
  assert.ok(google.searchParams.get('scope')?.includes('email'));
  assert.ok(google.searchParams.get('state'));
  console.log(
    'Public anonymous Data API read/write denial and Google authorization initiation verified; no Google login or consent performed.',
  );
}
