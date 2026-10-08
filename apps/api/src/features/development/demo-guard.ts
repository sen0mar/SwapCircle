import { assertLocalRuntimeTarget } from '@swapcircle/database';

export const hostedDemoAuth = 'https://tpanyqfgmbpsiejqjocd.supabase.co';
export const hostedDemoApi = 'https://swapcircle-wqu8.onrender.com';
export const hostedDemoFrontend = 'https://swapcircle.pages.dev';

export function assertHostedDemoTarget(
  environment: string | undefined,
  authUrl: string,
  databaseUrl: string | undefined,
) {
  const target = databaseUrl ? URL.parse(databaseUrl) : null;

  if (
    environment !== 'production' ||
    authUrl !== hostedDemoAuth ||
    !target ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.username !== 'swapcircle_runtime.tpanyqfgmbpsiejqjocd' ||
    !target.password ||
    target.hostname !== 'aws-0-eu-west-1.pooler.supabase.com' ||
    target.port !== '5432' ||
    target.pathname !== '/postgres' ||
    target.search ||
    target.hash
  )
    throw new Error('Hosted demo requires the approved production targets.');
}

export function assertDemoTarget(
  environment: string | undefined,
  authUrl: string,
  databaseUrl: string | undefined,
) {
  if (environment !== 'development' || authUrl !== 'http://127.0.0.1:55431') {
    throw new Error('Demo access requires the isolated development stack.');
  }

  assertLocalRuntimeTarget(databaseUrl, environment);
}
