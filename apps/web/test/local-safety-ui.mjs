// Synthetic local accounts; real Express/PostgreSQL and production UI. Only OAuth handoff is simulated.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4198';
const apiOrigin = 'http://127.0.0.1:4318';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4318, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob] = fixture.users;
const output = new URL('../test-results/safety-local/', import.meta.url);
let preview;
let browser;
const api = async (path, user, body, method = 'GET') => {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: {
      ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `Local API status ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const signIn = async (page, user) => {
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
  await page.goto(`${origin}/account`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(
    page.getByText('Your session is verified.', { exact: false }),
  ).toBeVisible();
};
try {
  for (const [user, displayName] of [
    [alice, 'Local Alice'],
    [bob, 'Local Bob'],
  ])
    await api(
      '/profiles/me',
      user,
      {
        displayName,
        biography: 'Public synthetic biography.',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
  const item = await api(
    '/listings',
    bob,
    {
      title: 'Local safety field guide',
      description: 'A synthetic public item.',
      condition: 'good',
    },
    'POST',
  );
  execFileSync('pnpm', ['build'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      VITE_API_URL: apiOrigin,
      VITE_SUPABASE_URL: fixture.publicAuth.url,
      VITE_SUPABASE_PUBLISHABLE_KEY: fixture.publicAuth.key,
    },
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
      '4198',
      '--strictPort',
    ],
    { cwd: new URL('..', import.meta.url), stdio: 'ignore', detached: true },
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
  const aliceContext = await browser.newContext({ reducedMotion: 'reduce' });
  const bobContext = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await aliceContext.newPage();
  const otherPage = await bobContext.newPage();
  await signIn(page, alice);
  await signIn(otherPage, bob);
  await page.goto(`${origin}/members/${bob.id}`);
  const block = page.getByRole('button', { name: 'Block member', exact: true });
  await block.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(block).toBeFocused();
  await block.click();
  // Simulate losing the response after the real write: status refetch must reconcile it.
  await page.route(
    `${apiOrigin}/api/v1/safety/blocks`,
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Confirm block', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'result could not be confirmed',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Unblock member', exact: true }),
  ).toBeVisible();
  assert.equal((await api('/safety/blocks', alice)).items[0].userId, bob.id);
  assert.equal((await api('/safety/blocks', bob)).items.length, 0);
  await page.reload();
  await expect(
    page.getByText('You have blocked this member.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  const reason = `Private synthetic concern ${randomUUID()}`;
  await page.getByLabel('Reason for reporting').fill(reason);
  const submissions = [];
  await page.route(
    `${apiOrigin}/api/v1/safety/reports`,
    async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'result could not be confirmed',
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await expect(page.getByLabel('Reason for reporting')).toHaveValue(reason);
  await page.route(
    `${apiOrigin}/api/v1/safety/reports`,
    async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Retry report' }).click();
  await expect(
    page.getByText('Report received.', { exact: false }),
  ).toBeVisible();
  assert.deepEqual(submissions[0], submissions[1]);
  const reports = await fixture.migration.query(
    'SELECT count(*)::int AS count FROM public.reports WHERE reporter_id=$1 AND client_report_id=$2',
    [alice.id, submissions[0].clientReportId],
  );
  assert.equal(reports.rows[0].count, 1);
  await page.keyboard.press('Escape');
  await page.goto(`${origin}/listings/${item.id}`);
  await expect(
    page.getByRole('button', { name: 'Unblock member', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Report item', exact: true }).click();
  await page.getByLabel('Reason for reporting').fill('Synthetic item concern.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByText('Report received.', { exact: false }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${origin}/account/settings`);
  await expect(
    page.getByRole('link', { name: 'Local Bob', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Unblock member', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm unblock', exact: true })
    .click();
  await expect(page.getByText('No blocked members.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Blocked members', exact: true }),
  ).toBeFocused();
  assert.equal((await api('/safety/blocks', alice)).items.length, 0);
  // Current restrictions remain private. Safety actions remain available.
  await fixture.migration.query(
    'INSERT INTO public.account_restrictions (user_id, reason) VALUES ($1,$2)',
    [alice.id, 'Private synthetic internal restriction'],
  );
  await page.reload();
  await expect(
    page.getByText('Changes and new contact', { exact: false }),
  ).toBeVisible();
  await page.goto(`${origin}/account/profile`);
  await page.getByLabel('Display name').fill('Changed Local Alice');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'currently unavailable for your account',
  );
  await page.goto(`${origin}/members/${bob.id}`);
  await page.getByRole('button', { name: 'Block member', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirm block', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Unblock member', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await page
    .getByLabel('Reason for reporting')
    .fill('Restricted account can still report.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByText('Report received.', { exact: false }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  for (const path of [
    `/members/${alice.id}`,
    `/listings/${item.id}`,
    '/browse',
    '/',
  ]) {
    await otherPage.goto(`${origin}${path}`);
    await expect(otherPage.locator('main')).toBeVisible();
    const text = await otherPage.locator('body').innerText();
    assert.ok(!text.includes(reason));
    assert.ok(!text.includes('Private synthetic internal restriction'));
    assert.ok(!text.includes('Changes and new contact'));
  }
  for (const path of [
    `/members/${alice.id}`,
    `/listings/${item.id}`,
    '/listings?q=Local',
    '/members?limit=20',
  ]) {
    const data = await api(path, bob);
    assert.ok(!JSON.stringify(data).includes(reason));
    assert.ok(
      !JSON.stringify(data).includes('Private synthetic internal restriction'),
    );
  }
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/members/${bob.id}`);
      await expect(
        page.getByRole('button', { name: 'Unblock member', exact: true }),
      ).toBeVisible();
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
      if ([360, 1280].includes(width))
        await page.screenshot({
          path: new URL(`${theme}-${width}-member.png`, output).pathname,
          fullPage: true,
        });
      await page
        .getByRole('button', { name: 'Report member', exact: true })
        .click();
      await page
        .getByLabel('Reason for reporting')
        .fill('Synthetic draft for visual verification.');
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      if ([360, 1280].includes(width))
        await page.screenshot({
          path: new URL(`${theme}-${width}-report.png`, output).pathname,
          fullPage: true,
        });
      await page.keyboard.press('Escape');
      await page.goto(`${origin}/account/settings`);
      await expect(
        page.getByRole('link', { name: 'Local Bob', exact: true }),
      ).toBeVisible();
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      if ([360, 1280].includes(width))
        await page.screenshot({
          path: new URL(`${theme}-${width}-settings.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  await otherPage.goto(`${origin}/account/settings`);
  await expect(otherPage.getByText('No blocked members.')).toBeVisible();
  console.log(
    'Local safety UI: two isolated accounts, persisted blocks, uncertain-response reconciliation, retry-safe member/item reports, explicit unblock, current restriction recovery, safety access and public privacy passed; Light/Dark axe/layout checks at 360/768/800/1280/1600px and screenshots captured.',
  );
} finally {
  if (browser) await browser.close();
  if (preview?.pid) {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
  }
  await new Promise((resolve) => server.close(resolve));
  await fixture.cleanup();
}
