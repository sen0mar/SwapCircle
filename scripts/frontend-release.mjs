import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import {
  intendedReadiness,
  releaseRevision,
  verifyChecks,
} from './api-release.mjs';

const { fetch, AbortSignal, URL } = globalThis;
export const account = '40baa5468a639e3f2372271a6b88a17b';
export const project = 'swapcircle-staging';
export const apiOrigin = 'https://swapcircle-staging-api.onrender.com';
export const supabaseOrigin = 'https://tpanyqfgmbpsiejqjocd.supabase.co';
const output = 'apps/web/dist';
const publicNames = [
  'VITE_API_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_BUILD_REVISION',
  'VITE_SENTRY_DSN',
];

export function browserEnvironment(environment) {
  const revision = releaseRevision(environment);

  assert.equal(environment.VITE_API_URL, apiOrigin);
  assert.equal(environment.VITE_SUPABASE_URL, supabaseOrigin);
  assert.equal(environment.VITE_BUILD_REVISION, revision);
  for (const name of Object.keys(environment)) {
    assert.ok(
      !name.startsWith('VITE_') || publicNames.includes(name),
      'Unexpected public environment variable.',
    );
  }
  const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

  assert.match(key, /^sb_publishable_[A-Za-z0-9_-]+$/);
  if (environment.VITE_SENTRY_DSN) {
    const dsn = new URL(environment.VITE_SENTRY_DSN);

    assert.equal(dsn.protocol, 'https:');
    assert.match(dsn.hostname, /^o\d+\.ingest(?:\.[a-z]+)?\.sentry\.io$/);
    assert.ok(dsn.username && !dsn.password && /^\/\d+$/.test(dsn.pathname));
  }

  return Object.fromEntries([
    ...['PATH', 'HOME', 'CI']
      .filter((name) => environment[name])
      .map((name) => [name, environment[name]]),
    ...publicNames
      .filter((name) => environment[name])
      .map((name) => [name, environment[name]]),
    ['SWAPCIRCLE_RELEASE_BUILD', '1'],
    ['SENTRY_SOURCE_MAPS', '1'],
  ]);
}

export function securityHeaders(html, dsn) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter(Boolean);

  assert.equal(
    scripts.length,
    1,
    'Only the reviewed theme bootstrap may be inline.',
  );
  const hash = createHash('sha256').update(scripts[0]).digest('base64');
  const sentry = dsn ? ` ${new URL(dsn).origin}` : '';
  const csp = `default-src 'none'; script-src 'self' 'sha256-${hash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${supabaseOrigin}; font-src 'self'; connect-src 'self' ${apiOrigin} ${supabaseOrigin} ${supabaseOrigin.replace('https:', 'wss:')}${sentry}; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`;

  return `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Strict-Transport-Security: max-age=31536000\n`;
}

async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(`${directory}/${entry.name}`)
          : `${directory}/${entry.name}`,
      ),
    )
  ).flat();
}

export function auditText(text) {
  assert.ok(
    !/sb_secret_[A-Za-z0-9_-]{16,}|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}|service_role|postgres(?:ql)?:\/\/|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|sourceMappingURL\s*=|Alex Example|Jamie Demo|Priya Demo|Development-only profile fixture|Development homepage preview|Development API status|Sample listings for design preview|Sample interests from the preview community|Synthetic conversation previews|Messaging is not available yet|Interest discovery is not available yet|This is a sample conversation, not a real message\./.test(
      text,
    ),
    'Public artifact audit refused.',
  );
}

export async function auditBuild() {
  const paths = await files(output);

  assert.ok(
    !paths.some((path) =>
      /(?:\.map$|\/404\.html$|\/\.env|\/_worker\.js$|\/functions\/)/.test(path),
    ),
  );
  for (const path of paths) {
    if (/\.(?:js|css|html|json|txt)$/.test(path))
      auditText(await readFile(path, 'utf8'));
  }
  assert.equal(
    JSON.parse(await readFile(`${output}/release.json`, 'utf8')).revision,
    process.env.RELEASE_REVISION,
  );
  assert.equal(
    await readFile(`${output}/_redirects`, 'utf8'),
    '/* /index.html 200\n',
  );
  assert.equal(
    await readFile(`${output}/_headers`, 'utf8'),
    securityHeaders(
      await readFile(`${output}/index.html`, 'utf8'),
      process.env.VITE_SENTRY_DSN,
    ),
  );
  console.log(`Public artifact audit passed (${paths.length} files).`);
}

function execute(command, args, environment) {
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'pipe',
    timeout: 300_000,
  });

  assert.equal(
    result.status,
    0,
    'Controlled frontend command failed; output withheld.',
  );
}

export async function requireReady(environment) {
  const revision = releaseRevision(environment);
  const response = await fetch(`${apiOrigin}/api/v1/ready`, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });

  assert.ok(
    intendedReadiness(response, await response.json(), revision),
    'Intended API revision is not ready.',
  );
}

async function cloudflare(environment, path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}${path}`,
    {
      headers: { Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(20_000),
    },
  );

  assert.ok(response.ok, 'Cloudflare request refused.');
  const body = await response.json();

  assert.equal(body.success, true);
  return body.result;
}

export function intendedProject(value, environment) {
  assert.equal(environment.CLOUDFLARE_ACCOUNT_ID, account);
  assert.equal(value.name, project);
  assert.equal(value.subdomain, `${project}.pages.dev`);
  assert.equal(value.production_branch, 'main');
  assert.ok(
    !value.source,
    'Only the existing Direct Upload project is allowed.',
  );
  assert.ok(
    !value.deployment_configs?.production?.env_vars ||
      Object.keys(value.deployment_configs.production.env_vars).length === 0,
    'Static upload cannot consume provider runtime credentials.',
  );
}

async function upload(environment) {
  await verifyChecks(environment);
  await requireReady(environment);
  browserEnvironment(environment);
  await auditBuild();
  intendedProject(await cloudflare(environment, ''), environment);
  execute(
    'pnpm',
    [
      'exec',
      'wrangler',
      'pages',
      'deploy',
      output,
      '--project-name',
      project,
      '--branch',
      'main',
      '--commit-hash',
      environment.RELEASE_REVISION,
      '--commit-dirty=false',
    ],
    {
      PATH: environment.PATH,
      HOME: environment.HOME,
      CI: 'true',
      CLOUDFLARE_ACCOUNT_ID: account,
      CLOUDFLARE_API_TOKEN: environment.CLOUDFLARE_API_TOKEN,
      WRANGLER_SEND_METRICS: 'false',
    },
  );
  const value = await cloudflare(environment, '');
  const deployment = value.canonical_deployment;

  assert.equal(deployment?.environment, 'production');
  assert.equal(
    deployment?.deployment_trigger?.metadata?.commit_hash,
    environment.RELEASE_REVISION,
  );
  assert.equal(deployment?.latest_stage?.status, 'success');
  console.log(
    `Pages deployment verified: ${deployment.id}, revision ${environment.RELEASE_REVISION}.`,
  );
}

async function build(environment) {
  const safe = browserEnvironment(environment);

  execute('pnpm', ['--filter', '@swapcircle/web', 'build'], safe);
  const html = await readFile(`${output}/index.html`, 'utf8');

  await writeFile(
    `${output}/_headers`,
    securityHeaders(html, safe.VITE_SENTRY_DSN),
  );
  await writeFile(`${output}/_redirects`, '/* /index.html 200\n');
  await writeFile(
    `${output}/release.json`,
    JSON.stringify({ revision: environment.RELEASE_REVISION }),
  );
  console.log('Browser-only release build completed with private maps.');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const command = process.argv[2];

    assert.ok(['build', 'audit', 'upload', 'ready'].includes(command));
    if (command === 'build') await build(process.env);
    else if (command === 'audit') await auditBuild();
    else if (command === 'ready') await requireReady(process.env);
    else await upload(process.env);
  } catch {
    console.error(
      'Controlled frontend release refused or failed; credentials and provider output withheld.',
    );
    process.exitCode = 1;
  }
}
