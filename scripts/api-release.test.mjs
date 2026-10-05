import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL } from 'node:url';
import {
  releaseRevision,
  successfulChecks,
  intendedDeploy,
  intendedReadiness,
  intendedService,
  buildCommand,
  startCommand,
  repository,
} from './api-release.mjs';

const revision = 'a'.repeat(40);
const environment = {
  RELEASE_REVISION: revision,
  GITHUB_SHA: revision,
  GITHUB_REPOSITORY: repository,
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF_TYPE: 'branch',
};
const run = {
  head_sha: revision,
  head_repository: { full_name: repository },
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
};
const jobs = ['checks', 'database'].map((name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
}));

test('release rejects PRs, foreign repositories, tags and a different checked-out SHA', () => {
  assert.equal(releaseRevision(environment), revision);
  for (const change of [
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'fork/SwapCircle' },
    { GITHUB_REF_TYPE: 'tag' },
    { GITHUB_SHA: 'b'.repeat(40) },
  ])
    assert.throws(() => releaseRevision({ ...environment, ...change }));
});

test('exact trusted CI requires successful checks and database, never skipped/neutral/missing', () => {
  successfulChecks(run, jobs, revision, 'main');
  for (const change of [
    { head_sha: 'b'.repeat(40) },
    { event: 'pull_request' },
    { head_branch: 'fork' },
    { head_repository: { full_name: 'fork/SwapCircle' } },
    { path: '.github/workflows/other.yml' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
  ])
    assert.throws(() =>
      successfulChecks({ ...run, ...change }, jobs, revision, 'main'),
    );
  for (const conclusion of ['skipped', 'neutral', 'failure', null])
    assert.throws(() =>
      successfulChecks(
        run,
        [jobs[0], { ...jobs[1], conclusion }],
        revision,
        'main',
      ),
    );
  assert.throws(() =>
    successfulChecks(run, jobs.slice(0, 1), revision, 'main'),
  );
});

test('hook acceptance and wrong healthy build never count as success', () => {
  assert.equal(
    intendedDeploy(
      { commit: { id: revision }, status: 'build_in_progress' },
      revision,
    ),
    false,
  );
  assert.equal(
    intendedDeploy({ commit: { id: revision }, status: 'live' }, revision),
    true,
  );
  assert.throws(() =>
    intendedDeploy(
      { commit: { id: 'b'.repeat(40) }, status: 'live' },
      revision,
    ),
  );
  assert.throws(() =>
    intendedDeploy(
      { commit: { id: revision }, status: 'build_failed' },
      revision,
    ),
  );
  assert.equal(
    intendedReadiness({ status: 200 }, { status: 'ready', revision }, revision),
    true,
  );
  assert.equal(
    intendedReadiness(
      { status: 200 },
      { status: 'ready', revision: 'b'.repeat(40) },
      revision,
    ),
    false,
  );
  assert.equal(
    intendedReadiness(
      { status: 503 },
      { status: 'unavailable', revision },
      revision,
    ),
    false,
  );
});

test('service validation refuses unrelated services, paid plans and automatic deploys', () => {
  const env = {
    RENDER_SERVICE_ID: 'srv-intended',
    RENDER_API_URL: 'https://swapcircle-wqu8.onrender.com',
  };
  const service = {
    id: env.RENDER_SERVICE_ID,
    ownerId: 'tea-d5qvc063jp1c73fekfag',
    name: 'SwapCircle',
    type: 'web_service',
    repo: `https://github.com/${repository}`,
    autoDeployTrigger: 'off',
    serviceDetails: {
      plan: 'free',
      runtime: 'node',
      healthCheckPath: '/api/v1/ready',
      url: env.RENDER_API_URL,
      envSpecificDetails: { buildCommand, startCommand },
    },
  };

  intendedService(service, env);
  for (const change of [
    { id: 'srv-d96t0c67r5hc738ck5k0' },
    { name: 'stafflow-api' },
    { name: 'swapcircle-staging-api' },
    {
      serviceDetails: {
        ...service.serviceDetails,
        url: 'https://swapcircle-staging-api.onrender.com',
      },
    },
    { autoDeployTrigger: 'commit' },
    { serviceDetails: { ...service.serviceDetails, plan: 'starter' } },
  ])
    assert.throws(() => intendedService({ ...service, ...change }, env));
});

test('release configuration keeps global serialization and secrets isolated from PR jobs', async () => {
  const { readFile } = await import('node:fs/promises');
  const ci = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  const release = ci.slice(ci.indexOf('  api-release:\n'));

  assert.match(
    ci,
    /inputs\.frontend_release_revision != ''\) && github\.run_id \|\| github\.ref/,
  );
  assert.match(
    ci,
    /cancel-in-progress: \$\{\{ !\(github\.event_name == 'workflow_dispatch' && \(inputs\.api_release_revision != '' \|\| inputs\.frontend_release_revision != ''\)\) \}\}/,
  );
  assert.match(
    release,
    /group: swapcircle-production-release\n {6}cancel-in-progress: false/,
  );
  assert.match(
    release,
    /github\.repository == 'sen0mar\/SwapCircle' && github\.event_name == 'workflow_dispatch' && \(inputs\.api_release_revision != '' \|\| inputs\.frontend_release_revision != ''\)/,
  );
  assert.ok(!release.includes('uses: ./.github/workflows/'));
  assert.match(release, /environment: production/);
  assert.ok(
    release.indexOf('api-release.mjs checks') <
      release.indexOf('secrets.MIGRATION_DATABASE_URL'),
  );
  assert.ok(
    release.indexOf('release-migrations.ts') <
      release.indexOf('api-release.mjs deploy'),
  );
  assert.ok(!release.includes('secrets.DATABASE_URL'));
  assert.ok(!release.includes('secrets.SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(!ci.includes('secrets: inherit'));

  const migration = release.slice(
    release.indexOf('      - name: Verify and apply'),
    release.indexOf('      - name: Deploy and verify'),
  );
  const deploy = release.slice(
    release.indexOf('      - name: Deploy and verify'),
  );

  assert.match(migration, /secrets\.MIGRATION_DATABASE_URL/);
  assert.match(migration, /secrets\.DATABASE_CA_CERT/);
  assert.ok(!migration.includes('secrets.RENDER_API_KEY'));
  assert.match(deploy, /secrets\.RENDER_API_KEY/);
  assert.ok(!deploy.includes('secrets.MIGRATION_DATABASE_URL'));
  assert.ok(!deploy.includes('secrets.DATABASE_CA_CERT'));
});

test('provisioning refuses admin, wrong-project and shared runtime passwords before transmission', async () => {
  const { provisioningTarget } = await import('./provision-api.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const folder = mkdtempSync(`${tmpdir()}/swapcircle-provision-`);
  const cert = `${folder}/ca.crt`;

  writeFileSync(cert, 'Synthetic configuration test CA');
  const target = {
    DATABASE_URL:
      'postgres://swapcircle_runtime.tpanyqfgmbpsiejqjocd:runtime-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    MIGRATION_DATABASE_URL:
      'postgres://postgres.tpanyqfgmbpsiejqjocd:admin-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres',
    DATABASE_CA_CERT_PATH: cert,
    SUPABASE_URL: 'https://tpanyqfgmbpsiejqjocd.supabase.co',
    FRONTEND_URL: 'https://swapcircle.pages.dev',
  };
  const authorization = 'configure-approved-project';

  try {
    provisioningTarget(target, authorization);
    for (const change of [
      { DATABASE_URL: undefined },
      { DATABASE_URL: target.MIGRATION_DATABASE_URL },
      {
        DATABASE_URL: target.DATABASE_URL.replace(
          'runtime-password',
          'admin-password',
        ),
      },
      {
        DATABASE_URL: target.DATABASE_URL.replace(
          'tpanyqfgmbpsiejqjocd',
          'aaaaaaaaaaaaaaaaaaaa',
        ),
      },
      { DATABASE_URL: target.DATABASE_URL.replace(':5432/', ':6543/') },
    ])
      assert.throws(() =>
        provisioningTarget({ ...target, ...change }, authorization),
      );
    assert.throws(() => provisioningTarget(target, undefined));
  } finally {
    rmSync(folder, { recursive: true });
  }
});
