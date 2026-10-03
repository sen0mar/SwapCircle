import { databaseConfig, DatabaseConfigurationError } from '../src/config.ts';

export const hostedRef = 'tpanyqfgmbpsiejqjocd';
export const hostedOrigin = 'https://swapcircle-staging.pages.dev';

export function hostedTarget(environment: NodeJS.ProcessEnv) {
  const url = environment.MIGRATION_DATABASE_URL;

  databaseConfig(url, false, environment);
  const target = new URL(url!);

  if (
    environment.HOSTED_AUTHORIZATION !== 'configure-approved-project' ||
    environment.SUPABASE_URL !== `https://${hostedRef}.supabase.co` ||
    environment.FRONTEND_URL !== hostedOrigin ||
    !environment.DATABASE_CA_CERT_PATH ||
    target.hostname !== 'aws-0-eu-west-1.pooler.supabase.com' ||
    target.port !== '5432' ||
    target.username !== `postgres.${hostedRef}`
  )
    throw new DatabaseConfigurationError(
      'Approved hosted project, origin, session pooler and verified CA required.',
    );

  if (environment.DATABASE_URL) {
    databaseConfig(environment.DATABASE_URL, true, environment);
    const runtime = new URL(environment.DATABASE_URL);

    if (
      runtime.hostname !== target.hostname ||
      runtime.port !== target.port ||
      runtime.username !== `swapcircle_runtime.${hostedRef}` ||
      runtime.password === target.password
    )
      throw new DatabaseConfigurationError(
        'Hosted runtime must use separate credentials on the approved project.',
      );
  }

  return target;
}
