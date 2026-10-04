import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import {
  browserEnvironment,
  securityHeaders,
  auditText,
  intendedProject,
  account,
  project,
  apiOrigin,
  supabaseOrigin,
} from './frontend-release.mjs';
import { releaseRevision } from './api-release.mjs';

const revision = 'a'.repeat(40);
const environment = {
  RELEASE_REVISION: revision,
  GITHUB_SHA: revision,
  GITHUB_REPOSITORY: 'sen0mar/SwapCircle',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF_TYPE: 'branch',
  VITE_API_URL: apiOrigin,
  VITE_SUPABASE_URL: supabaseOrigin,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  VITE_BUILD_REVISION: revision,
  PATH: '/synthetic',
  HOME: '/synthetic',
  MIGRATION_DATABASE_URL: 'private',
  SUPABASE_SERVICE_ROLE_KEY: 'private',
  SENTRY_AUTH_TOKEN: 'private',
  CLOUDFLARE_API_TOKEN: 'private',
  GH_TOKEN: 'private',
};

test('browser build strips credentials, rejects secret public keys, foreign URLs and unexpected VITE variables', () => {
  const safe = browserEnvironment(environment);

  for (const name of [
    'MIGRATION_DATABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SENTRY_AUTH_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'GH_TOKEN',
  ])
    assert.ok(!(name in safe));
  assert.equal(safe.SWAPCIRCLE_RELEASE_BUILD, '1');
  for (const change of [
    { VITE_API_URL: 'https://other.example' },
    { VITE_SUPABASE_URL: 'https://other.supabase.co' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' },
    { VITE_BUILD_REVISION: 'b'.repeat(40) },
    { VITE_PRIVATE_KEY: 'private' },
    { VITE_SENTRY_DSN: 'https://public:private@o1.ingest.sentry.io/1' },
    { VITE_SENTRY_DSN: 'https://public@other.example/1' },
  ])
    assert.throws(() => browserEnvironment({ ...environment, ...change }));
});

test('manual release refuses ambiguous or mismatched named inputs', () => {
  releaseRevision({
    ...environment,
    API_RELEASE_REVISION: '',
    FRONTEND_RELEASE_REVISION: revision,
  });
  for (const change of [
    { API_RELEASE_REVISION: revision, FRONTEND_RELEASE_REVISION: revision },
    { API_RELEASE_REVISION: '', FRONTEND_RELEASE_REVISION: '' },
    { FRONTEND_RELEASE_REVISION: 'b'.repeat(40) },
  ])
    assert.throws(() => releaseRevision({ ...environment, ...change }));
});

test('CSP hashes exact theme script and limits network access to reviewed origins', () => {
  const headers = securityHeaders(
    '<script>theme()</script><script type="module" src="/assets/app.js"></script>',
  );

  assert.match(headers, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!headers.includes("script-src 'self' 'unsafe-inline'"));
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /wss:\/\/tpanyqfgmbpsiejqjocd.supabase.co/);
  assert.notEqual(headers, securityHeaders('<script>changed()</script>'));
  assert.throws(() =>
    securityHeaders('<script>one()</script><script>two()</script>'),
  );
});

test('public artifact audit refuses private credentials, maps and development identities', () => {
  auditText('Public build revision and safe error');
  for (const text of [
    'sb_secret_syntheticprivatesecret',
    'service_role',
    'postgres://synthetic',
    '//# sourceMappingURL=app.js.map',
    'Jamie Demo',
    'Development API status',
  ])
    assert.throws(() => auditText(text));
});

test('Pages upload refuses unrelated accounts, projects, branches, Git integration and runtime configuration', () => {
  const value = {
    name: project,
    subdomain: `${project}.pages.dev`,
    production_branch: 'main',
  };

  intendedProject(value, { CLOUDFLARE_ACCOUNT_ID: account });
  assert.throws(() =>
    intendedProject(value, { CLOUDFLARE_ACCOUNT_ID: 'other' }),
  );
  for (const change of [
    { name: 'other' },
    { production_branch: 'preview' },
    { source: { type: 'github' } },
    { deployment_configs: { production: { env_vars: { SECRET: 'private' } } } },
  ])
    assert.throws(() =>
      intendedProject(
        { ...value, ...change },
        { CLOUDFLARE_ACCOUNT_ID: account },
      ),
    );
});

test('full release keeps readiness, build, private maps, audit, upload and deployed smoke in order with phase-only credentials', async () => {
  const ci = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const release = ci.slice(ci.indexOf('  api-release:\n'));
  const phases = [
    'api-release.mjs checks',
    'release-migrations.ts',
    'api-release.mjs deploy',
    'frontend-release.mjs build',
    'sentry-source-maps.mjs',
    'frontend-release.mjs audit',
    'frontend-release.mjs upload',
    'frontend-smoke.mjs',
  ];

  for (let index = 1; index < phases.length; index++)
    assert.ok(
      release.indexOf(phases[index - 1]) < release.indexOf(phases[index]),
    );
  const upload = release.slice(
    release.indexOf('      - name: Require exact readiness'),
    release.indexOf('      - name: Smoke'),
  );

  assert.match(upload, /secrets.CLOUDFLARE_API_TOKEN/);
  for (const name of [
    'MIGRATION_DATABASE_URL',
    'RENDER_API_KEY',
    'SENTRY_AUTH_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])
    assert.ok(!upload.includes(`secrets.${name}`));
  assert.match(
    release,
    /group: swapcircle-staging-release\n {6}cancel-in-progress: false/,
  );
  assert.ok(!ci.includes('secrets: inherit'));
});
