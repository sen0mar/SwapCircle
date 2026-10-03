import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyHostedPublicAccess } from '../scripts/verify-hosted-auth.ts';
import { hostedRef } from '../scripts/hosted-target.ts';

const environment = {
  SUPABASE_URL: `https://${hostedRef}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key',
  GOOGLE_CLIENT_ID: 'synthetic-google-client',
};

function transport(
  anonymousStatus = 401,
  callbackRef = hostedRef,
): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, environment.SUPABASE_URL);

    if (url.pathname.startsWith('/rest/v1/')) {
      assert.ok(['GET', 'POST'].includes(options?.method ?? ''));
      if (options?.method === 'POST') assert.equal(options.body, '{}');
      return Response.json({ code: '42501' }, { status: anonymousStatus });
    }

    assert.equal(url.pathname, '/auth/v1/authorize');
    assert.equal(
      url.searchParams.get('redirect_to'),
      'https://swapcircle-staging.pages.dev/auth/callback',
    );
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.searchParams.set('client_id', environment.GOOGLE_CLIENT_ID);
    google.searchParams.set(
      'redirect_uri',
      `https://${callbackRef}.supabase.co/auth/v1/callback`,
    );
    google.searchParams.set('response_type', 'code');
    google.searchParams.set('scope', 'openid email profile');
    google.searchParams.set('state', 'synthetic-state');
    return new Response(null, {
      status: 302,
      headers: { location: google.href },
    });
  };
}

test('public checks require permission denial and the intended Google callback without following login', async () => {
  await verifyHostedPublicAccess(environment, transport());
  await assert.rejects(verifyHostedPublicAccess(environment, transport(200)));
  await assert.rejects(
    verifyHostedPublicAccess(
      environment,
      transport(401, 'aaaaaaaaaaaaaaaaaaaa'),
    ),
  );
});
