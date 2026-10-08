// Exercise actual controlled assets with isolated browser request failures only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { chromium, expect } from '@playwright/test';
// Load the actual release driver too: its runtime imports must resolve in this workspace.
import { requireUnavailableItem } from '../../../scripts/frontend-smoke.mjs';
import {
  apiOrigin,
  supabaseOrigin,
  securityHeaders,
  auditBuild,
} from '../../../scripts/frontend-release.mjs';

const root = new URL('../../..', import.meta.url).pathname;
const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).stdout.trim();
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: process.env.CI ?? '',
  RELEASE_REVISION: revision,
  GITHUB_SHA: revision,
  GITHUB_REPOSITORY: 'sen0mar/SwapCircle',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF_TYPE: 'branch',
  VITE_API_URL: apiOrigin,
  VITE_SUPABASE_URL: supabaseOrigin,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_isolatedbuildtest',
  VITE_BUILD_REVISION: revision,
};
const build = spawnSync('node', ['scripts/frontend-release.mjs', 'build'], {
  cwd: root,
  env: environment,
  stdio: 'pipe',
  timeout: 180_000,
});

assert.equal(
  build.status,
  0,
  'Controlled browser build failed; output withheld.',
);
process.chdir(root);
// Audit fails closed while hidden maps exist; actual private upload/cleanup has focused tooling tests.
Object.assign(process.env, environment);
await assert.rejects(auditBuild);
for (const file of await readdir('apps/web/dist/assets')) {
  if (file.endsWith('.map')) await rm(`apps/web/dist/assets/${file}`);
}
await auditBuild();
const html = await readFile('apps/web/dist/index.html', 'utf8');
const csp = securityHeaders(html).match(/Content-Security-Policy: (.*)/)[1];
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const file = path.startsWith('/assets/')
    ? resolve('apps/web/dist', `.${path}`)
    : resolve('apps/web/dist/index.html');

  if (!file.startsWith(resolve('apps/web/dist') + '/')) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader(
      'Content-Type',
      file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.jpg')
            ? 'image/jpeg'
            : 'text/html',
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  const violations = [];
  const errors = [];

  // No traffic or production credentials reach any hosted service from this preview.
  await page.route(`${apiOrigin}/**`, (route) => route.abort());
  await page.route(`${supabaseOrigin}/**`, (route) => route.abort());
  page.on('pageerror', () => errors.push('Page error'));
  await page.addInitScript(() => {
    globalThis.__cspViolations = [];
    globalThis.document.addEventListener('securitypolicyviolation', (event) =>
      globalThis.__cspViolations.push(event.violatedDirective),
    );
  });
  const collect = async () =>
    violations.push(
      ...(await page.evaluate(
        () => globalThis.__cspViolations?.splice(0) ?? [],
      )),
    );
  const visit = async (url) => {
    await collect();
    await page.goto(url);
  };
  const reload = async () => {
    await collect();
    await page.reload();
  };
  await visit(origin);
  await expect(
    page.getByRole('heading', { name: 'Less stuff. More connection.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Items could not be loaded.' }),
  ).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.getByLabel('Theme').selectOption(theme);
    await reload();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme-preference',
      theme,
    );
  }
  await visit(`${origin}/browse?condition=good`);
  await reload();
  await expect(
    page.getByRole('heading', { name: 'Browse', exact: true }),
  ).toBeVisible();
  assert.equal(await page.getByLabel('Condition').inputValue(), 'good');
  await visit(`${origin}/account/settings`);
  await expect(
    page.getByRole('heading', { name: 'Sign in to SwapCircle' }),
  ).toBeVisible();
  await visit(`${origin}/auth/callback?error=access_denied`);
  await reload();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Sign-in could not be completed' }),
  ).toBeVisible();

  const missingItem = '00000000-0000-4000-8000-000000000000';

  await page.route(`${apiOrigin}/api/v1/listings/${missingItem}`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Item not found.' } },
    }),
  );
  await visit(`${origin}/listings/${missingItem}`);
  await requireUnavailableItem(page);
  await expect(
    page.getByText('This item cannot be found or has been withdrawn.', {
      exact: true,
    }),
  ).toBeVisible();

  await visit(`${origin}/dev/api-status`);
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible();
  await collect();
  assert.deepEqual(violations, []);
  assert.deepEqual(errors, []);
  console.log(
    'Controlled production build, map rejection, public audit, real CSP/theme bootstrap, nested reload and safe auth/API failures passed on isolated mocked traffic.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
