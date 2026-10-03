import { readFileSync } from 'node:fs';

export class DatabaseConfigurationError extends Error {}

export function databaseConfig(
  value: string | undefined,
  runtime = true,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!value)
    throw new DatabaseConfigurationError(
      'Missing database connection configuration.',
    );

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new DatabaseConfigurationError(
      'Invalid database connection configuration.',
    );
  }

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.pathname !== '/postgres' ||
    url.search ||
    url.hash ||
    (runtime && !validRuntimeUsername(url, environment.SUPABASE_URL))
  )
    throw new DatabaseConfigurationError(
      'Invalid database connection configuration.',
    );

  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);

  return {
    connectionString: value,
    max: runtime ? 5 : 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    ssl: local
      ? (false as const)
      : {
          rejectUnauthorized: true as const,
          ...(environment.DATABASE_CA_CERT_PATH
            ? { ca: readFileSync(environment.DATABASE_CA_CERT_PATH, 'utf8') }
            : {}),
        },
  };
}

function validRuntimeUsername(url: URL, supabaseUrl: string | undefined) {
  if (url.username === 'swapcircle_runtime') return true;

  const ref = /^swapcircle_runtime\.([a-z0-9]{20})$/.exec(url.username)?.[1];

  return Boolean(
    ref &&
    supabaseUrl === `https://${ref}.supabase.co` &&
    /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.port === '5432',
  );
}

export function assertLocalTarget(
  value: string | undefined,
  environment: string | undefined,
) {
  databaseConfig(value, false);

  const url = new URL(value!);

  if (
    !['development', 'test'].includes(environment ?? '') ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55432' ||
    url.username !== 'postgres'
  )
    throw new DatabaseConfigurationError(
      'Refusing operation: requires the isolated SwapCircle local database and development/test environment.',
    );
}

export function assertLocalRuntimeTarget(
  value: string | undefined,
  environment: string | undefined,
) {
  databaseConfig(value);
  const target = new URL(value!);
  // Reuse the exact local authority check, while retaining runtime-role validation.
  target.username = 'postgres';
  assertLocalTarget(target.href, environment);
}
