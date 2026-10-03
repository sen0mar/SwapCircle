import { databaseConfig } from '../src/config.ts';

export function approvedHostedTarget(
  environment: NodeJS.ProcessEnv,
  command: string | undefined,
) {
  if (
    environment.BACKUP_AUTHORIZATION !== 'approved-hosted-export' ||
    environment.BACKUP_MAINTENANCE_ACKNOWLEDGED !== '1' ||
    !['key', 'database-export', 'storage-export'].includes(command ?? '')
  )
    throw new Error(
      'Hosted export requires offline authorization; hosted restore is refused.',
    );
  databaseConfig(environment.BACKUP_DATABASE_URL, false);
  const database = new URL(environment.BACKUP_DATABASE_URL!);
  const ref = environment.BACKUP_APPROVED_PROJECT_REF;
  if (
    !ref ||
    !/^[a-z0-9]{20}$/.test(ref) ||
    !environment.BACKUP_CA_FILE ||
    database.hostname !== environment.BACKUP_APPROVED_DATABASE_HOST ||
    (database.port && database.port !== '5432')
  )
    throw new Error(
      'Explicit project, database host and verified TLS required.',
    );
  const direct =
    database.hostname === `db.${ref}.supabase.co` &&
    database.username === 'postgres';
  const pooled =
    database.hostname.endsWith('.pooler.supabase.com') &&
    decodeURIComponent(database.username) === `postgres.${ref}`;
  if (!direct && !pooled)
    throw new Error(
      'Database and Storage must belong to the approved project.',
    );
  const api = new URL(environment.BACKUP_SUPABASE_URL!);
  if (
    api.href !== `https://${ref}.supabase.co/` ||
    !environment.BACKUP_SERVICE_ROLE_KEY
  )
    throw new Error(
      'Storage project must match the approved database project.',
    );
  return database;
}
