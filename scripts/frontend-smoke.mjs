import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { frontendOrigin } from './api-release.mjs';
import {
  requireReady,
  securityHeaders,
  auditText,
} from './frontend-release.mjs';

const { fetch, AbortSignal, URL } = globalThis;
const require = createRequire(
  new URL('../apps/web/package.json', import.meta.url),
);
const { chromium } = require('playwright');

export async function smoke(environment) {
  await requireReady(environment);
  const localHtml = await readFile('apps/web/dist/index.html', 'utf8');
  const expectedCsp = securityHeaders(
    localHtml,
    environment.VITE_SENTRY_DSN,
  ).match(/Content-Security-Policy: (.*)/)[1];

  for (const path of [
    '/',
    '/browse',
    '/account/settings',
    '/auth/callback?error=access_denied',
  ]) {
    const response = await fetch(`${frontendOrigin}${path}`, {
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), expectedCsp);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(await response.text(), localHtml);
  }
  const deployed = await fetch(`${frontendOrigin}/release.json`, {
    signal: AbortSignal.timeout(30_000),
  });

  assert.equal((await deployed.json()).revision, environment.RELEASE_REVISION);
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    const errors = [];
    const violations = [];

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
    await visit(frontendOrigin);
    await page
      .getByRole('heading', { name: 'Less stuff. More connection.' })
      .waitFor();
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    await page
      .getByText('No available items shared yet.', { exact: true })
      .or(page.locator('.listing-card').first())
      .waitFor({ timeout: 60_000 });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: /favorite|follow|connect|going/i })
        .count(),
      0,
    );
    const directory = 'apps/web/test-results/frontend-release';

    await mkdir(directory, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      await reload();
      assert.equal(
        await page.locator('html').getAttribute('data-theme-preference'),
        theme,
      );
      await page
        .getByRole('heading', { name: 'Less stuff. More connection.' })
        .waitFor();
      await page.screenshot({
        path: `${directory}/home-${theme}.png`,
        fullPage: true,
      });
    }
    await visit(`${frontendOrigin}/browse?condition=good`);
    await reload();
    await page.getByRole('heading', { name: 'Browse', exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Condition', { exact: true }).inputValue(),
      'good',
    );
    await visit(`${frontendOrigin}/account/settings`);
    await page
      .getByRole('heading', { name: 'Sign in to SwapCircle' })
      .waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Continue with Google' })
        .isEnabled(),
      true,
    );
    assert.equal(
      new URL(page.url()).searchParams.get('next'),
      '/account/settings',
    );
    await page.screenshot({ path: `${directory}/sign-in.png`, fullPage: true });
    await visit(`${frontendOrigin}/auth/callback?error=access_denied`);
    await reload();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Sign-in could not be completed' })
      .waitFor();
    await page.screenshot({
      path: `${directory}/callback-error.png`,
      fullPage: true,
    });
    await visit(
      `${frontendOrigin}/listings/00000000-0000-4000-8000-000000000000`,
    );
    await page
      .getByText(/not found|unavailable/i)
      .first()
      .waitFor({ timeout: 60_000 });
    await page.screenshot({
      path: `${directory}/safe-unavailable.png`,
      fullPage: true,
    });
    await visit(`${frontendOrigin}/dev/api-status`);
    await page.getByRole('heading', { name: 'Page not found' }).waitFor();
    auditText(await page.locator('body').innerText());
    assert.deepEqual(errors, []);
    await collect();
    assert.deepEqual(violations, []);
    await requireReady(environment);
    console.log(
      'Deployed frontend smoke passed: exact build/API, headers, Home, themes, direct routes, sign-in, callback cancellation and safe unavailable state. External Google login and member-authorized reads require separate human/session evidence.',
    );
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await smoke(process.env);
  } catch {
    console.error(
      'Deployed frontend smoke failed; browser/provider private output withheld.',
    );
    process.exitCode = 1;
  }
}
