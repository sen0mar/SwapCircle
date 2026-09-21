import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DatabaseConfigurationError } from '../src/config.ts';

// The CLI expects a TOML boolean, so enable the provider only for this start call.
// Restore the tracked credential-free configuration even when startup fails.
export function withLocalAuthConfig<T>(
  root: string,
  run: (environment: NodeJS.ProcessEnv) => T,
  environment: NodeJS.ProcessEnv = process.env,
): T {
  const envFile = `${root}/.env`;

  const local = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, 'utf8'))
    : {};

  const merged = { ...local, ...environment };
  const id = merged.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID;
  const secret = merged.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET;

  if (Boolean(id) !== Boolean(secret))
    throw new DatabaseConfigurationError(
      'Google OAuth requires both local client credentials.',
    );

  const path = `${root}/supabase/config.toml`;
  const original = readFileSync(path, 'utf8');
  const section = /(\[auth\.external\.google\]\s*\n)enabled = (?:true|false)/;

  if (!section.test(original))
    throw new DatabaseConfigurationError(
      'Missing local Google provider configuration.',
    );

  const configured = original.replace(
    section,
    `$1enabled = ${Boolean(id && secret)}`,
  );

  try {
    if (configured !== original) writeFileSync(path, configured);

    return run(merged);
  } finally {
    if (configured !== original) writeFileSync(path, original);
  }
}
