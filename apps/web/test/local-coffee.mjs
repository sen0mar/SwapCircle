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
const interests = (
  await fixture.migration.query(
    'SELECT id, name FROM public.interests ORDER BY id LIMIT 3',
  )
).rows;
const output = new URL('../test-results/coffee-local/', import.meta.url);
let preview;
let browser;

const api = async (path, user, body, method = 'GET') => {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    signal: globalThis.AbortSignal.timeout(15000),
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
        displayName: ['Coffee Alice', 'Coffee Bob', 'Coffee Carol'][index],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: interests.slice(0, index === 0 ? 3 : 1).map((i) => i.id),
      },
      'PUT',
    );
    for (let j = 0; j < 2; j++)
      items.push(
        await api(
          '/listings',
          user,
          {
            title: `Coffee item ${index + 1}-${j + 1}`,
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
  await signIn(carolPage, stranger, `/swaps/${group.id}`);
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
        if (width === 360 || width === 1280) {
          await page.screenshot({
            path: new URL(`${state}-${theme}-${width}.png`, output).pathname,
            fullPage: true,
          });
          await coffee(page).screenshot({
            path: new URL(`${state}-${theme}-${width}-coffee.png`, output)
              .pathname,
          });
        }
      }
    }
  };
  const pair = (page, name) =>
    page.getByRole('region', { name: `Coffee with ${name}`, exact: true });
  const coffee = (page) =>
    page.getByRole('region', { name: 'Coffee invitations', exact: true });
  const aliceBob = pair(alicePage, 'Coffee Bob');
  const bobAlice = pair(bobPage, 'Coffee Alice');
  const updateInterests = (user, name, count) =>
    api(
      '/profiles/me',
      user,
      {
        displayName: name,
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: interests.slice(0, count).map((i) => i.id),
      },
      'PUT',
    );
  const refreshPair = async (page, name) => {
    await pair(page, name)
      .getByRole('button', { name: `Refresh coffee with ${name}` })
      .click();
  };
  await expect(aliceBob.getByLabel('Meet to swap')).toBeChecked();
  await expect(
    aliceBob.getByText(interests[0].name, { exact: true }),
  ).toBeVisible();
  await expect(aliceBob.getByLabel('Swap + coffee')).toHaveCount(0);
  await expect(aliceBob.getByLabel('Coffee on me')).toHaveCount(0);
  await capture(alicePage, 'one-interest');
  // One shared interest keeps Message and Trade available on the real public member view.
  await alicePage.goto(`${origin}/members/${bob.id}`);
  await expect(
    alicePage.getByRole('button', { name: 'Message', exact: true }),
  ).toBeEnabled();
  await alicePage.goto(`${origin}/swaps/${direct.id}`);
  await expect(
    alicePage.getByRole('button', { name: 'Review current terms' }),
  ).toBeEnabled();
  await updateInterests(bob, 'Coffee Bob', 2);
  await refreshPair(alicePage, 'Coffee Bob');
  await expect(aliceBob.getByLabel('Swap + coffee')).toBeVisible();
  await expect(
    aliceBob.getByText(interests[1].name, { exact: true }),
  ).toBeVisible();
  await expect(aliceBob.getByLabel('Meet to swap')).toBeChecked();
  for (const theme of ['light', 'dark']) {
    await alicePage.getByLabel('Theme').selectOption(theme);
    await aliceBob.getByLabel('Meet to swap').check();
    await aliceBob.getByLabel('Meet to swap').focus();
    await alicePage.keyboard.press('ArrowDown');
    await expect(aliceBob.getByLabel('Swap + coffee')).toBeChecked();
    await expect(aliceBob.getByLabel('Coffee on me')).not.toBeChecked();
    await aliceBob.getByLabel('Coffee on me').focus();
    await alicePage.keyboard.press('Space');
    await expect(aliceBob.getByLabel('Coffee on me')).toBeChecked();
    await alicePage.keyboard.press('Tab');
    await expect(
      aliceBob.getByRole('button', { name: 'Send coffee invitation' }),
    ).toBeFocused();
    await alicePage.keyboard.press('Shift+Tab');
    await expect(aliceBob.getByLabel('Coffee on me')).toBeFocused();
  }
  await capture(alicePage, 'eligible-offer');
  const baseline = await api(`/trades/${direct.id}`, alice);
  await aliceBob
    .getByRole('button', { name: 'Send coffee invitation' })
    .focus();
  await alicePage.keyboard.press('Enter');
  await expect(aliceBob).toContainText('You invited Coffee Bob');
  await expect(
    aliceBob.getByRole('heading', { name: 'You and Coffee Bob' }),
  ).toBeFocused();
  await refreshPair(bobPage, 'Coffee Alice');
  await expect(bobAlice).toContainText(
    'Coffee Alice offered to pay for coffee in person',
  );
  await capture(bobPage, 'recipient-pending');
  const pending = (await api(`/trades/${direct.id}/coffee`, alice))[0];
  const notice = (
    await fixture.migration.query(
      'SELECT id FROM public.notifications WHERE recipient_id=$1 AND resource_id=$2',
      [bob.id, pending.id],
    )
  ).rows[0];
  await bobPage.goto(`${origin}/notifications/${notice.id}`);
  await bobPage.getByRole('link', { name: 'View coffee in swap' }).click();
  await expect(bobPage).toHaveURL(`${origin}/swaps/${direct.id}#coffee`);
  await bobAlice.getByRole('button', { name: 'Decline coffee' }).focus();
  await bobPage.keyboard.press('Enter');
  await expect(coffee(bobPage)).toContainText('Coffee declined');
  assert.deepEqual(await api(`/trades/${direct.id}`, alice), baseline);
  await capture(bobPage, 'declined');
  // Current profile changes reject send and accept, preserve input, and never alter trade consent.
  await refreshPair(alicePage, 'Coffee Bob');
  await aliceBob.getByLabel('Swap + coffee').check();
  await aliceBob.getByLabel('Coffee on me').check();
  await updateInterests(bob, 'Coffee Bob', 1);
  await aliceBob
    .getByRole('button', { name: 'Send coffee invitation' })
    .click();
  await expect(aliceBob).toContainText('Shared interests changed');
  await expect(aliceBob.getByLabel('Swap + coffee')).toHaveCount(0);
  await expect(aliceBob).toContainText('Your coffee selection is preserved');
  await capture(alicePage, 'eligibility-changed');
  await updateInterests(bob, 'Coffee Bob', 2);
  await refreshPair(alicePage, 'Coffee Bob');
  await expect(aliceBob.getByLabel('Coffee on me')).toBeChecked();
  // Request fails before commit. Retry uses exactly the same operation key and offer.
  const payloads = [];
  let attempts = 0;
  await alicePage.route(`**/trades/${direct.id}/coffee`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    attempts++;
    if (attempts === 1) return route.abort('failed');
    return route.continue();
  });
  await aliceBob
    .getByRole('button', { name: 'Send coffee invitation' })
    .click();
  await expect(
    aliceBob.getByRole('button', { name: 'Retry coffee action' }),
  ).toBeVisible();
  await capture(alicePage, 'failed-send');
  await aliceBob.getByRole('button', { name: 'Retry coffee action' }).click();
  await expect(aliceBob).toContainText('You invited Coffee Bob');
  assert.deepEqual(payloads[1], payloads[0]);
  await alicePage.unroute(`**/trades/${direct.id}/coffee`);
  await refreshPair(bobPage, 'Coffee Alice');
  await expect(
    bobAlice.getByRole('button', { name: 'Accept coffee' }),
  ).toBeEnabled();
  await updateInterests(bob, 'Coffee Bob', 1);
  await bobAlice.getByRole('button', { name: 'Accept coffee' }).click();
  await expect(bobAlice).toContainText('Shared interests changed');
  await expect(
    bobAlice.getByRole('button', { name: 'Accept coffee' }),
  ).toBeDisabled();
  await expect(
    bobAlice.getByRole('button', { name: 'Decline coffee' }),
  ).toBeEnabled();
  await updateInterests(bob, 'Coffee Bob', 2);
  await refreshPair(bobPage, 'Coffee Alice');
  // Commit succeeds but response is lost. Independent server read shows agreement; same action retries safely.
  await bobPage.route(
    `**/trades/${direct.id}/coffee/*/respond`,
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
  );
  await bobAlice.getByRole('button', { name: 'Accept coffee' }).click();
  await expect(bobAlice).toContainText('Coffee agreed: you and Coffee Alice');
  await expect(
    bobAlice.getByRole('button', { name: 'Retry coffee action' }),
  ).toBeVisible();
  await bobPage.unroute(`**/trades/${direct.id}/coffee/*/respond`);
  await bobAlice.getByRole('button', { name: 'Retry coffee action' }).click();
  await expect(
    bobAlice.getByRole('button', { name: 'Retry coffee action' }),
  ).toHaveCount(0);
  await updateInterests(bob, 'Coffee Bob', 1);
  await refreshPair(bobPage, 'Coffee Alice');
  await expect(bobAlice).toContainText('Coffee agreed: you and Coffee Alice');
  await bobAlice.getByRole('button', { name: 'Cancel coffee' }).click();
  await expect(coffee(bobPage)).toContainText('Coffee cancelled');
  assert.deepEqual(await api(`/trades/${direct.id}`, alice), baseline);
  // Trade agreement is still independent and can confirm after coffee cancellation.
  await accept(alicePage);
  await accept(bobPage);
  await expect(agreement(bobPage)).toContainText('Agreement confirmed');
  const confirmed = await api(`/trades/${direct.id}`, bob);
  assert.equal(confirmed.status, 'confirmed');
  assert.ok(confirmed.items.every((i) => i.currentAvailability === 'reserved'));
  // Group pairs differ: Bob is eligible, Carol is not; only Alice/Bob agree.
  await updateInterests(bob, 'Coffee Bob', 2);
  for (const page of [alicePage, bobPage, carolPage])
    await page.goto(`${origin}/swaps/${group.id}`);
  await aliceBob.getByLabel('Swap + coffee').check();
  await expect(
    pair(alicePage, 'Coffee Carol').getByLabel('Swap + coffee'),
  ).toHaveCount(0);
  await expect(aliceBob.getByLabel('Coffee on me')).not.toBeChecked();
  const groupBaseline = await api(`/trades/${group.id}`, alice);
  await aliceBob
    .getByRole('button', { name: 'Send coffee invitation' })
    .click();
  await refreshPair(bobPage, 'Coffee Alice');
  await bobAlice.getByRole('button', { name: 'Accept coffee' }).click();
  await refreshPair(carolPage, 'Coffee Alice');
  await expect(coffee(carolPage)).toContainText(
    'Coffee Alice → Coffee Bob · Both agreed to coffee',
  );
  await expect(pair(carolPage, 'Coffee Alice')).not.toContainText(
    'Coffee agreed',
  );
  assert.deepEqual(await api(`/trades/${group.id}`, alice), groupBaseline);
  await capture(carolPage, 'group-pair');
  // Coffee read outage exposes recovery and cannot send using stale eligibility/list state.
  await alicePage.route(`**/trades/${group.id}/coffee*`, (route) =>
    route.abort('failed'),
  );
  await refreshPair(alicePage, 'Coffee Bob');
  await expect(coffee(alicePage)).toContainText(
    'Coffee invitations could not be refreshed',
  );
  await expect(
    aliceBob.getByRole('button', { name: 'Cancel coffee' }),
  ).toBeDisabled();
  await capture(alicePage, 'read-failure');
  await alicePage.unroute(`**/trades/${group.id}/coffee*`);
  await refreshPair(alicePage, 'Coffee Bob');
  await expect(
    aliceBob.getByRole('button', { name: 'Cancel coffee' }),
  ).toBeEnabled();
  assert.deepEqual(errors, []);
  console.info(
    'Real local coffee: 1/2 interests, default/optional offer, notification authorization, decline without trade changes, eligibility races, preserved same-key retries and lost response, acceptance/cancellation independence, explicit group pairs, keyboard, responsive Light/Dark and axe passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
