import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { hostedTarget } from '../packages/database/scripts/hosted-target.ts';
import {
  buildCommand,
  startCommand,
  reviewedMigrationDigest,
  verifyChecks,
  repository,
} from './api-release.mjs';

const { fetch, AbortSignal } = globalThis;

export function provisioningTarget(environment, authorization) {
  assert.ok(
    environment.DATABASE_URL,
    'Restricted runtime credentials required.',
  );
  return hostedTarget({ ...environment, HOSTED_AUTHORIZATION: authorization });
}

async function main() {
  assert.equal(process.env.HOSTED_AUTHORIZATION, 'configure-approved-project');
  assert.equal(process.versions.node, '24.13.0');
  assert.equal(statSync('.env.hosted').mode & 0o777, 0o600);
  const original = readFileSync('.env.hosted', 'utf8');
  const privateEnvironment = parseEnv(original);

  provisioningTarget(privateEnvironment, process.env.HOSTED_AUTHORIZATION);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const branch = execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  }).trim();
  const token = execFileSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const remote = JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/branches/${branch}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

  assert.equal(remote.commit.sha, revision);
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
  );
  assert.equal(privateEnvironment.RENDER_SERVICE_ID, '');
  assert.equal(privateEnvironment.RENDER_API_URL, '');
  assert.equal(privateEnvironment.FRONTEND_URL, 'https://swapcircle.pages.dev');
  assert.equal(
    privateEnvironment.SUPABASE_URL,
    'https://tpanyqfgmbpsiejqjocd.supabase.co',
  );
  await verifyChecks({
    RELEASE_REVISION: revision,
    GITHUB_SHA: revision,
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: repository,
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: branch,
    GH_TOKEN: token,
  });

  const migrationEnvironment = {
    ...process.env,
    MIGRATION_DATABASE_URL: privateEnvironment.MIGRATION_DATABASE_URL,
    SUPABASE_URL: privateEnvironment.SUPABASE_URL,
    FRONTEND_URL: privateEnvironment.FRONTEND_URL,
    DATABASE_CA_CERT_PATH: privateEnvironment.DATABASE_CA_CERT_PATH,
    HOSTED_REVIEWED_MIGRATION_SHA256: reviewedMigrationDigest,
  };

  assert.equal(migrationEnvironment.DATABASE_URL, undefined);
  execFileSync(
    process.execPath,
    ['packages/database/scripts/release-migrations.ts'],
    { env: migrationEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const headers = {
    Authorization: `Bearer ${privateEnvironment.RENDER_API_KEY}`,
    'Content-Type': 'application/json',
  };
  const existing = await fetch('https://api.render.com/v1/services?limit=100', {
    headers,
    signal: AbortSignal.timeout(20_000),
  });

  assert.equal(existing.status, 200);
  const services = await existing.json();

  assert.ok(
    services.length < 100,
    'Service inventory requires pagination before creation.',
  );
  assert.ok(
    !services.some((item) => item.service.name === 'swapcircle-staging-api'),
    'Intended service already exists; recover its identity instead of creating another.',
  );
  const values = {
    NODE_VERSION: '24.13.0',
    NODE_ENV: 'production',
    CORS_ORIGINS: privateEnvironment.FRONTEND_URL,
    DATABASE_CA_CERT_PATH: '/etc/secrets/supabase-ca.crt',
    DATABASE_URL: privateEnvironment.DATABASE_URL,
    SUPABASE_URL: privateEnvironment.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: privateEnvironment.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: privateEnvironment.SUPABASE_SERVICE_ROLE_KEY,
    SENTRY_DSN: privateEnvironment.SENTRY_DSN,
  };

  assert.ok(
    Object.values(values).every((value) => typeof value === 'string' && value),
  );
  const payload = {
    type: 'web_service',
    name: 'swapcircle-staging-api',
    ownerId: 'tea-d5qvc063jp1c73fekfag',
    repo: `https://github.com/${repository}`,
    branch,
    autoDeployTrigger: 'off',
    envVars: Object.entries(values).map(([key, value]) => ({ key, value })),
    secretFiles: [
      {
        name: 'supabase-ca.crt',
        content: readFileSync(privateEnvironment.DATABASE_CA_CERT_PATH, 'utf8'),
      },
    ],
    serviceDetails: {
      runtime: 'node',
      plan: 'free',
      region: 'frankfurt',
      numInstances: 1,
      healthCheckPath: '/api/v1/ready',
      previews: { generation: 'off' },
      envSpecificDetails: { buildCommand, startCommand },
    },
  };
  // Reconfirm the remote branch immediately before service creation/initial deploy.
  const latest = JSON.parse(
    execFileSync('gh', ['api', `repos/${repository}/branches/${branch}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

  assert.equal(latest.commit.sha, revision);
  const response = await fetch('https://api.render.com/v1/services', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal(
    response.status,
    201,
    `Intended free service creation refused (${response.status}).`,
  );
  const created = await response.json();
  const service = created.service ?? created;

  assert.equal(service.name, 'swapcircle-staging-api');
  assert.match(service.id, /^srv-[a-z0-9]+$/);
  assert.match(
    service.serviceDetails.url,
    /^https:\/\/swapcircle-staging-api[a-z0-9-]*\.onrender\.com$/,
  );
  assert.equal(readFileSync('.env.hosted', 'utf8'), original);
  writeFileSync(
    '.env.hosted',
    original
      .replace(/^RENDER_SERVICE_ID=\s*$/m, `RENDER_SERVICE_ID=${service.id}`)
      .replace(
        /^RENDER_API_URL=\s*$/m,
        `RENDER_API_URL=${service.serviceDetails.url}`,
      ),
    { mode: 0o600 },
  );
  console.log(
    `Created intended free service ${service.id}; initial deploy must be observed for ${revision}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      'Provisioning refused or failed. Inspect exact CI/target/service state; recover existing identity after an unknown outcome before retrying. Provider payloads and credentials withheld.',
    );
    process.exitCode = 1;
  });
}
