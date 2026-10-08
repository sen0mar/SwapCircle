// Real local Express/PostgreSQL and production browser with synthetic accounts.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;

const origin = 'http://127.0.0.1:4207';
const apiOrigin = 'http://127.0.0.1:4327';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4327, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/swaps-local/', import.meta.url);
let preview;
let browser;

const api = async (path, user, body, method = 'GET') => {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `Local API status ${response.status}: ${path}`);
  return response.json();
};

const signIn = async (page, user, destination) => {
  await page.route(
    `${fixture.publicAuth.url}/auth/v1/authorize?*`,
    async (route) => {
      const callback = new URL(
        new URL(route.request().url()).searchParams.get('redirect_to'),
      );
      callback.searchParams.set('code', 'local-synthetic-provider-handoff');
      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
    },
  );
  await page.route(`${fixture.publicAuth.url}/auth/v1/token?*`, (route) =>
    route.fulfill({
      json: { ...user.session, expires_in: 3600, token_type: 'bearer' },
    }),
  );
  await page.goto(`${origin}/swaps`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(
    page.getByRole('link', { name: 'My Swaps' }).first(),
  ).toBeVisible();
  await page.goto(`${origin}${destination}`);
  await expect(page).toHaveURL(`${origin}${destination}`);
};

try {
  for (const [user, displayName] of [
    [alice, 'Swap Alice'],
    [bob, 'Swap Bob'],
    [stranger, 'Swap Carol'],
  ])
    await api(
      '/profiles/me',
      user,
      {
        displayName,
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
  const aliceItem = await api(
    '/listings',
    alice,
    {
      title: `Desk lamp ${randomUUID().slice(0, 6)}`,
      description: 'Synthetic local lamp',
      condition: 'good',
    },
    'POST',
  );
  const bobItem = await api(
    '/listings',
    bob,
    {
      title: `Bicycle ${randomUUID().slice(0, 6)}`,
      description: 'Synthetic local bicycle',
      condition: 'good',
    },
    'POST',
  );

  const environment = {
    ...process.env,
    NODE_ENV: 'production',
    VITE_API_URL: apiOrigin,
    VITE_SUPABASE_URL: fixture.publicAuth.url,
    VITE_SUPABASE_PUBLISHABLE_KEY: fixture.publicAuth.key,
  };
  execFileSync('pnpm', ['build'], {
    cwd: new URL('..', import.meta.url),
    env: environment,
    stdio: 'pipe',
  });
  preview = spawn(
    'pnpm',
    [
      'exec',
      'vite',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4207',
      '--strictPort',
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: environment,
      stdio: 'ignore',
      detached: true,
    },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* Bounded startup. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const alicePage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const bobPage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const outsiderPage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, outsiderPage])
    page.on('pageerror', (error) => errors.push(error.message));

  await signIn(alicePage, alice, `/listings/${bobItem.id}`);
  await expect(
    alicePage.getByRole('button', { name: 'Propose a trade' }),
  ).toBeVisible();
  await alicePage.getByRole('button', { name: 'Propose a trade' }).click();
  await alicePage.getByRole('checkbox', { name: aliceItem.title }).check();
  await alicePage.getByRole('button', { name: 'Review proposal' }).click();
  await expect(alicePage.getByText(/Items are not reserved/)).toBeVisible();
  await alicePage.getByRole('button', { name: 'Send proposal' }).click();
  await expect(alicePage).toHaveURL(/\/swaps\/[0-9a-f-]+$/);
  const tradeId = alicePage.url().split('/').pop();
  await expect(
    alicePage.getByRole('heading', { name: 'Current terms', exact: true }),
  ).toBeVisible();
  await expect(
    alicePage.getByText('This is a proposal.', { exact: false }),
  ).toBeVisible();
  await alicePage.reload();
  await expect(alicePage.getByText(aliceItem.title).first()).toBeVisible();
  await alicePage.getByRole('link', { name: 'My Swaps' }).first().click();
  await expect(
    alicePage.getByRole('link', { name: 'View swap' }),
  ).toBeVisible();
  await alicePage.getByLabel('Theme').selectOption('light');
  await alicePage.setViewportSize({ width: 360, height: 900 });
  await alicePage.screenshot({
    path: new URL('alice-swaps-light-360.png', output).pathname,
    fullPage: true,
  });

  await signIn(bobPage, bob, '/swaps');
  await expect(bobPage.getByRole('link', { name: 'View swap' })).toBeVisible();
  await bobPage.reload();
  await expect(bobPage.getByRole('link', { name: 'View swap' })).toBeVisible();
  await bobPage.getByLabel('Theme').selectOption('dark');
  await bobPage.setViewportSize({ width: 1280, height: 900 });
  await bobPage.screenshot({
    path: new URL('bob-swaps-dark-1280.png', output).pathname,
    fullPage: true,
  });
  await bobPage.getByRole('button', { name: /Open notifications/ }).click();
  await expect(
    bobPage
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('link', { name: 'View swap' }),
  ).toBeVisible();
  await bobPage
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('link', { name: 'View swap' })
    .click();
  await expect(bobPage).toHaveURL(`${origin}/swaps/${tradeId}`);
  await expect(
    bobPage.getByRole('button', { name: 'Review current terms', exact: true }),
  ).toBeVisible();
  await expect(bobPage.getByText(bobItem.title).first()).toBeVisible();

  const state = await fixture.migration.query(
    'SELECT invitation_status,accepted_version FROM public.trade_participants WHERE trade_id=$1 AND user_id=$2',
    [tradeId, bob.id],
  );
  assert.equal(state.rows[0].invitation_status, 'invited');
  assert.equal(state.rows[0].accepted_version, null);
  const listings = await fixture.migration.query(
    'SELECT availability FROM public.listings WHERE id=ANY($1::uuid[])',
    [[aliceItem.id, bobItem.id]],
  );
  assert.ok(listings.rows.every((row) => row.availability === 'available'));

  await signIn(outsiderPage, stranger, `/swaps/${tradeId}`);
  await expect(
    outsiderPage.getByText(
      'This swap cannot be found or you do not have access.',
    ),
  ).toBeVisible();
  assert.equal((await api('/trades/mine', stranger)).items.length, 0);

  await fixture.migration.query(
    "UPDATE public.listings SET availability='withdrawn' WHERE id=$1",
    [aliceItem.id],
  );
  await bobPage.reload();
  await expect(
    bobPage.getByText(/proposed item is no longer available/),
  ).toBeVisible();

  for (const [name, page] of [
    ['alice', alicePage],
    ['bob', bobPage],
  ]) {
    await page.goto(`${origin}/swaps/${tradeId}`);
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      for (const width of [360, 768, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.innerWidth,
          ),
        );
        assert.deepEqual(
          (await new AxeBuilder({ page }).analyze()).violations,
          [],
        );
        if (width === 360 || width === 1280)
          await page.screenshot({
            path: new URL(`${name}-${theme}-${width}.png`, output).pathname,
            fullPage: true,
          });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    'Local swap submission, notification, both lists, private access, withdrawn state, themes and accessibility passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
