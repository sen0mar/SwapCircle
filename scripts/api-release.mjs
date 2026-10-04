import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const { fetch, AbortSignal } = globalThis;

export const repository = 'sen0mar/SwapCircle';
export const frontendOrigin = 'https://swapcircle.pages.dev';
export const buildCommand =
  'corepack pnpm install --frozen-lockfile && corepack pnpm --filter @swapcircle/api... build';
export const startCommand = 'node scripts/start-api.mjs';
export const reviewedMigrationDigest =
  'a3b4e7945b9ce81257aa83344e2b7b77af0a243031e21396ef73a356122bd29d';

export function releaseRevision(environment) {
  assert.match(environment.RELEASE_REVISION ?? '', /^[a-f0-9]{40}$/);
  assert.equal(environment.GITHUB_REPOSITORY, repository);
  assert.equal(environment.GITHUB_EVENT_NAME, 'workflow_dispatch');
  assert.equal(environment.GITHUB_SHA, environment.RELEASE_REVISION);
  assert.equal(environment.GITHUB_REF_TYPE, 'branch');
  if (
    'API_RELEASE_REVISION' in environment ||
    'FRONTEND_RELEASE_REVISION' in environment
  ) {
    const inputs = [
      environment.API_RELEASE_REVISION,
      environment.FRONTEND_RELEASE_REVISION,
    ].filter(Boolean);

    assert.equal(
      inputs.length,
      1,
      'Choose exactly one controlled release input.',
    );
    assert.equal(inputs[0], environment.RELEASE_REVISION);
  }

  return environment.RELEASE_REVISION;
}

export function successfulChecks(run, jobs, revision, branch) {
  assert.equal(run.head_sha, revision);
  assert.equal(run.head_repository?.full_name, repository);
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, branch);
  assert.equal(run.path, '.github/workflows/ci.yml');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');

  for (const name of ['checks', 'database']) {
    const matches = jobs.filter((job) => job.name === name);

    assert.equal(matches.length, 1);
    assert.equal(matches[0].status, 'completed');
    assert.equal(matches[0].conclusion, 'success');
  }
}

export function intendedService(service, environment) {
  assert.match(environment.RENDER_SERVICE_ID ?? '', /^srv-[a-z0-9]+$/);
  assert.equal(service.id, environment.RENDER_SERVICE_ID);
  assert.equal(service.ownerId, 'tea-d5qvc063jp1c73fekfag');
  assert.equal(service.name, 'swapcircle-staging-api');
  assert.equal(service.type, 'web_service');
  assert.equal(service.repo, `https://github.com/${repository}`);
  assert.equal(service.autoDeployTrigger, 'off');
  assert.equal(service.serviceDetails.plan, 'free');
  assert.equal(service.serviceDetails.runtime, 'node');
  assert.equal(service.serviceDetails.healthCheckPath, '/api/v1/ready');
  assert.equal(
    service.serviceDetails.envSpecificDetails.buildCommand,
    buildCommand,
  );
  assert.equal(
    service.serviceDetails.envSpecificDetails.startCommand,
    startCommand,
  );
  assert.equal(service.serviceDetails.url, environment.RENDER_API_URL);
  assert.match(
    environment.RENDER_API_URL,
    /^https:\/\/swapcircle-staging-api[a-z0-9-]*\.onrender\.com$/,
  );
}

export function intendedDeploy(deploy, revision) {
  assert.equal(deploy.commit?.id, revision);
  assert.ok(
    ![
      'build_failed',
      'update_failed',
      'canceled',
      'pre_deploy_failed',
      'deactivated',
    ].includes(deploy.status),
    'Render deploy failed.',
  );

  return deploy.status === 'live';
}

export function intendedReadiness(response, body, revision) {
  return (
    response.status === 200 &&
    body?.status === 'ready' &&
    body.revision === revision
  );
}

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });

  assert.ok(response.ok, `Provider request refused (${response.status}).`);

  return response.json();
}

export async function verifyChecks(environment) {
  const revision = releaseRevision(environment);
  const base = `https://api.github.com/repos/${repository}/actions`;
  const headers = { Accept: 'application/vnd.github+json' };
  const runs = await request(
    `${base}/workflows/ci.yml/runs?head_sha=${revision}&event=push&per_page=100`,
    environment.GH_TOKEN,
    { headers },
  );
  const run = runs.workflow_runs
    .filter(
      (item) =>
        item.head_sha === revision &&
        item.head_branch === environment.GITHUB_REF_NAME,
    )
    .sort((a, b) => b.id - a.id)[0];

  assert.ok(run, 'Required exact-revision push CI is missing.');
  const jobs = await request(
    `${base}/runs/${run.id}/jobs?filter=latest&per_page=100`,
    environment.GH_TOKEN,
    { headers },
  );

  successfulChecks(run, jobs.jobs, revision, environment.GITHUB_REF_NAME);
  console.log(`Required checks passed for ${revision}.`);
}

export async function deployApi(environment) {
  const revision = releaseRevision(environment);
  // Recheck immediately before mutation, independently of the earlier gate.
  await verifyChecks(environment);
  const base = `https://api.render.com/v1/services/${environment.RENDER_SERVICE_ID}`;
  const token = environment.RENDER_API_KEY;

  intendedService(await request(base, token), environment);
  const before = await request(`${base}/deploys?limit=20`, token);
  const previous = before
    .map((item) => item.deploy)
    .find((item) => item.status === 'live');

  if (previous)
    console.log(
      `Retained rollback build: ${previous.id}, revision ${previous.commit.id}. No schema reversal is performed.`,
    );
  const created = await request(`${base}/deploys`, token, {
    method: 'POST',
    body: JSON.stringify({ commitId: revision, clearCache: 'do_not_clear' }),
  });

  assert.match(created.id, /^dep-[a-z0-9]+$/);
  console.log(`Observing deploy ${created.id} for ${revision}.`);
  const deadline = Date.now() + 25 * 60_000;

  while (Date.now() < deadline) {
    const deploy = await request(`${base}/deploys/${created.id}`, token);

    if (intendedDeploy(deploy, revision)) {
      for (let attempt = 0; attempt < 36; attempt++) {
        try {
          const response = await fetch(
            `${environment.RENDER_API_URL}/api/v1/ready`,
            { signal: AbortSignal.timeout(15_000), redirect: 'error' },
          );
          const body = await response.json();

          if (intendedReadiness(response, body, revision)) {
            console.log(`Hosted API ready at intended revision ${revision}.`);
            return;
          }
        } catch {
          /* A cold start can return non-JSON; it never counts as ready. */
        }

        await setTimeout(5_000);
      }

      throw new Error('Intended revision did not become ready.');
    }

    await setTimeout(10_000);
  }

  throw new Error(
    `Observation timed out; resume existing deploy ${created.id}, do not trigger another release.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const command = process.argv[2];

  try {
    assert.ok(['checks', 'deploy'].includes(command));
    if (command === 'checks') await verifyChecks(process.env);
    else await deployApi(process.env);
  } catch {
    console.error(
      'Controlled API release refused or failed; inspect check/deploy status. Provider payloads and credentials are withheld.',
    );
    process.exitCode = 1;
  }
}
