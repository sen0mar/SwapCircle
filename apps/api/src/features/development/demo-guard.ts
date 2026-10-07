import { assertLocalRuntimeTarget } from '@swapcircle/database';

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
