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

const origin = 'http://127.0.0.1:4210';
const apiOrigin = 'http://127.0.0.1:4330';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4330, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/acceptances-local/', import.meta.url);
let preview;
let browser;
let releaseAcceptance = () => {};

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
  const users = [alice, bob, stranger];
  const items = [];
  for (const [index, user] of users.entries()) {
    await api(
      '/profiles/me',
      user,
      {
        displayName: ['Agreement Alice', 'Agreement Bob', 'Agreement Carol'][
          index
        ],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
    for (let j = 0; j < 2; j++)
      items.push(
        await api(
          '/listings',
          user,
          {
            title: `Agreement item ${index + 1}-${j + 1}`,
            description: 'Synthetic agreement item',
            condition: 'good',
          },
          'POST',
        ),
      );
  }
  const propose = (members, listings) =>
    api(
      '/trades',
      members[0],
      {
        operationKey: randomUUID(),
        participantIds: members.map((u) => u.id),
        transfers: listings.map((item, i) => ({
          listingId: item.id,
          ownerId: members[i].id,
          recipientId: members[(i + 1) % members.length].id,
        })),
        meetingMode: 'meet_to_swap',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      'POST',
    );
  const direct = await propose([alice, bob], [items[0], items[2]]);
  const competing = await propose([alice, stranger], [items[0], items[4]]);
  const group = await propose(users, [items[1], items[3], items[5]]);
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
      '4210',
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
      /* bounded startup */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const alicePage = await (await browser.newContext()).newPage();
  const bobPage = await (await browser.newContext()).newPage();
  const carolPage = await (await browser.newContext()).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, carolPage])
    page.on('pageerror', (error) => errors.push(error.message));

  await signIn(alicePage, alice, `/swaps/${direct.id}`);
  await signIn(bobPage, bob, `/swaps/${direct.id}`);
  await signIn(carolPage, stranger, `/swaps/${competing.id}`);
  const agreement = (page) =>
    page.getByRole('region', { name: 'Agreement', exact: true });
  const review = async (page) => {
    await page.getByRole('button', { name: 'Review current terms' }).click();
    await expect(
      page.getByRole('region', { name: 'Acceptance review' }),
    ).toBeVisible();
  };
  const accept = async (page) => {
    await review(page);
    await page.getByRole('button', { name: 'Accept version 1' }).click();
  };
  const capture = async (page, state) => {
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      for (const width of [360, 768, 800, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => globalThis.scrollTo(0, 0));
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
            path: new URL(`${state}-${theme}-${width}.png`, output).pathname,
            fullPage: true,
          });
      }
    }
  };
  // Merely visiting or reviewing never accepts. Old competing review survives a reservation conflict.
  assert.equal(
    (await api(`/trades/${direct.id}`, alice)).participants[0].acceptedVersion,
    null,
  );
  await review(carolPage);
  await review(alicePage);
  await expect(
    alicePage.getByRole('region', { name: 'Acceptance review' }),
  ).toContainText('Agreement item 1-1 to Agreement Bob');
  await capture(alicePage, 'review');
  await alicePage.getByRole('button', { name: 'Accept version 1' }).focus();
  await alicePage.keyboard.press('Enter');
  await expect(agreement(alicePage)).toContainText('Your acceptance is saved');
  await expect(
    alicePage.getByRole('heading', {
      name: 'Agree to current terms',
      exact: true,
    }),
  ).toBeFocused();
  assert.equal(
    (await api(`/listings/${items[0].id}`, alice)).availability,
    'available',
  );
  await capture(alicePage, 'pending');
  await bobPage.getByRole('button', { name: 'Refresh agreement' }).click();
  await expect(agreement(bobPage)).toContainText('1 of 2');
  // Commit succeeds but the response is lost: authoritative read still confirms the outcome.
  let committed = false;
  const releaseResponse = new Promise((resolve) => {
    releaseAcceptance = resolve;
  });
  await bobPage.route(`**/trades/${direct.id}/accept`, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    committed = true;
    await releaseResponse;
    await route.abort('failed');
  });
  await accept(bobPage);
  await expect.poll(() => committed).toBe(true);
  await expect(
    bobPage.getByRole('button', { name: 'Saving acceptance…' }),
  ).toBeDisabled();
  await expect(
    bobPage.getByText('Proposed · Version 1', { exact: true }),
  ).toBeVisible();
  releaseAcceptance();
  await expect(agreement(bobPage)).toContainText('Agreement confirmed');
  await expect(agreement(bobPage)).toContainText('not physical handover');
  await bobPage.unroute(`**/trades/${direct.id}/accept`);
  await alicePage.goto(`${origin}/swaps`);
  await expect(
    alicePage.getByText('Confirmed · agreement reached'),
  ).toBeVisible();
  await alicePage.goto(`${origin}/swaps/${direct.id}`);
  await expect(agreement(alicePage)).toContainText('Agreement confirmed');
  await capture(alicePage, 'confirmed');
  await alicePage.goto(`${origin}/listings/${items[0].id}`);
  await expect(
    alicePage.getByText('Currently unavailable for a trade', { exact: true }),
  ).toBeVisible();
  await alicePage.getByRole('link', { name: 'My Shelf', exact: true }).click();
  await expect(
    alicePage.locator('.shelf-item').filter({
      has: alicePage.getByRole('heading', {
        name: items[0].title,
        exact: true,
      }),
    }),
  ).toContainText('Reserved');
  // Another proposal cannot reserve the same item and keeps the reviewed outgoing/incoming summary.
  await carolPage.getByRole('button', { name: 'Accept version 1' }).click();
  await expect(agreement(carolPage)).toContainText(
    'An item became unavailable',
  );
  await expect(
    carolPage.getByRole('button', { name: 'Accept version 1' }),
  ).toBeDisabled();
  await expect(
    carolPage.getByRole('region', { name: 'Acceptance review' }),
  ).toContainText('Agreement item 1-1');
  assert.equal(
    (await api(`/trades/${competing.id}`, stranger)).status,
    'proposed',
  );
  const reservations = await fixture.migration.query(
    'SELECT trade_id FROM public.item_reservations WHERE listing_id=$1 AND released_at IS NULL',
    [items[0].id],
  );
  assert.deepEqual(
    reservations.rows.map((r) => r.trade_id),
    [direct.id],
  );
  await capture(carolPage, 'conflict');
  // Three participant acceptance is independent of group chat consent.
  for (const page of [alicePage, bobPage, carolPage])
    await page.goto(`${origin}/swaps/${group.id}`);
  await accept(alicePage);
  await accept(bobPage);
  await expect(agreement(bobPage)).toContainText('2 of 3');
  assert.equal(
    (await api(`/listings/${items[1].id}`, alice)).availability,
    'available',
  );
  await accept(carolPage);
  await expect(agreement(carolPage)).toContainText('Agreement confirmed');
  for (const page of [alicePage, bobPage]) {
    await page.reload();
    await expect(agreement(page)).toContainText('Everyone accepted version 1');
  }
  const groupTerms = await api(`/trades/${group.id}`, alice);
  assert.ok(groupTerms.participants.every((p) => p.acceptedVersion === 1));
  assert.ok(
    groupTerms.items.every((i) => i.currentAvailability === 'reserved'),
  );
  await capture(carolPage, 'group-confirmed');
  assert.deepEqual(errors, []);
  console.info(
    'Real direct/group cross-user acceptance, pending availability, lost response recovery, navigation refresh, competing reservation conflict, keyboard, both themes, responsive and axe checks passed.',
  );
} finally {
  releaseAcceptance();
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
