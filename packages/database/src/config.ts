export class DatabaseConfigurationError extends Error {}

export function databaseConfig(value: string | undefined, runtime = true) {
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
    (runtime && url.username !== 'swapcircle_runtime')
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
    ssl: local ? (false as const) : { rejectUnauthorized: true as const },
  };
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
