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
const output = new URL('../test-results/lifecycle-local/', import.meta.url);
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
  const interestIds = interests.slice(0, 2).map((i) => i.id);
  for (const [index, user] of [alice, bob, stranger].entries()) {
    await api(
      '/profiles/me',
      user,
      {
        displayName: ['Lifecycle Alice', 'Lifecycle Bob', 'Lifecycle Carol'][
          index
        ],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds,
      },
      'PUT',
    );
  }
  const item = (user, title) =>
    api(
      '/listings',
      user,
      {
        title,
        description: 'Synthetic lifecycle item',
        condition: 'good',
      },
      'POST',
    );
  const left = await item(alice, 'Synthetic camera');
  const right = await item(bob, 'Synthetic backpack');
  const propose = () =>
    api(
      '/trades',
      alice,
      {
        operationKey: randomUUID(),
        participantIds: [alice.id, bob.id],
        transfers: [
          { listingId: left.id, ownerId: alice.id, recipientId: bob.id },
          { listingId: right.id, ownerId: bob.id, recipientId: alice.id },
        ],
        meetingMode: 'meet_to_swap',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      'POST',
    );
  const declined = await propose();
  const expired = await propose();
  const cancelled = await propose();
  const competing = await propose();
  const stale = await propose();
  const replay = await propose();
  const sameVersion = await propose();
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
  const alicePage = await (
    await browser.newContext({ timezoneId: 'Europe/Paris' })
  ).newPage();
  const bobPage = await (
    await browser.newContext({ timezoneId: 'America/New_York' })
  ).newPage();
  const outsider = await (await browser.newContext()).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, outsider])
    page.on('pageerror', (e) => errors.push(e.message));

  const lifecycle = (page) =>
    page.getByRole('region', { name: 'Swap lifecycle' });
  const capture = async (page, state, target = lifecycle(page)) => {
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
          await target.screenshot({
            path: new URL(`${state}-${theme}-${width}-panel.png`, output)
              .pathname,
          });
        }
      }
    }
  };
  await signIn(alicePage, alice, `/swaps/${declined.id}`);
  await signIn(bobPage, bob, `/swaps/${declined.id}`);
  await signIn(outsider, stranger, `/swaps/${declined.id}`);
  await expect(
    outsider.getByRole('heading', { name: 'Swap unavailable' }),
  ).toBeVisible();
  await expect(outsider.getByText('Synthetic camera')).toHaveCount(0);

  // A separate coffee cancellation does not close the proposal.
  const invitation = await api(
    `/trades/${declined.id}/coffee`,
    alice,
    {
      operationKey: randomUUID(),
      inviteeId: bob.id,
      offerToPay: true,
    },
    'POST',
  );
  await api(
    `/trades/${declined.id}/coffee/${invitation.id}/respond`,
    bob,
    { action: 'accept' },
    'POST',
  );
  await bobPage
    .getByRole('button', {
      name: 'Refresh coffee with Lifecycle Alice',
      exact: true,
    })
    .click();
  await bobPage
    .getByRole('button', { name: 'Cancel coffee', exact: true })
    .click();
  assert.equal((await api(`/trades/${declined.id}`, bob)).status, 'proposed');

  for (const theme of ['light', 'dark']) {
    await bobPage.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await bobPage.setViewportSize({ width, height: 900 });
      const trigger = lifecycle(bobPage).getByRole('button', {
        name: 'Decline proposal',
      });
      await trigger.focus();
      await bobPage.keyboard.press('Enter');
      const dialog = bobPage.getByRole('dialog');
      await expect(dialog).toBeVisible();
      if (width === 360) {
        assert.ok(
          await dialog
            .locator('.notification-actions')
            .evaluate((actions) =>
              [...actions.querySelectorAll('button')].every(
                (button) =>
                  Math.abs(
                    button.getBoundingClientRect().width -
                      actions.getBoundingClientRect().width,
                  ) < 1,
              ),
            ),
        );
      }

      await expect(dialog).toContainText(
        'closes version 1 for all participants',
      );
      for (let i = 0; i < 6; i++) {
        await bobPage.keyboard.press('Tab');
        assert.ok(
          await dialog.evaluate((node) =>
            node.contains(globalThis.document.activeElement),
          ),
        );
      }
      assert.deepEqual(
        (await new AxeBuilder({ page: bobPage }).analyze()).violations,
        [],
      );
      await bobPage.screenshot({
        path: new URL(`confirmation-${theme}-${width}.png`, output).pathname,
      });
      await bobPage.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    }
  }
  await lifecycle(bobPage)
    .getByRole('button', { name: 'Decline proposal' })
    .click();
  await bobPage
    .getByRole('button', { name: 'Confirm decline', exact: true })
    .click();
  await expect(lifecycle(bobPage)).toContainText(
    'A participant declined this proposal',
  );
  await expect(
    bobPage.getByRole('heading', { name: 'History', exact: true }),
  ).toBeVisible();
  await expect(
    bobPage.getByRole('heading', { name: 'Closed swap' }),
  ).toBeFocused();
  assert.equal(
    (await api(`/trades/${declined.id}`, alice)).events.at(-1).eventType,
    'declined',
  );
  await capture(bobPage, 'declined');

  // Only the local synthetic fixture clock is changed, never the browser clock.
  await fixture.migration.query(
    "UPDATE public.trades SET created_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
    [expired.id],
  );
  await alicePage.goto(`${origin}/swaps/${expired.id}`);
  await expect(lifecycle(alicePage)).toContainText(
    'server has marked this proposal expired',
  );
  await expect(
    alicePage.getByRole('button', { name: 'Review current terms' }),
  ).toHaveCount(0);
  await capture(alicePage, 'expired');

  // Confirmed cancellation does not release locally while the response is withheld.
  const accept = (id, user, key = randomUUID()) =>
    api(
      `/trades/${id}/accept`,
      user,
      { expectedVersion: 1, operationKey: key },
      'POST',
    );
  await accept(cancelled.id, alice);
  await accept(cancelled.id, bob);
  assert.equal(
    (await api(`/listings/${left.id}`, alice)).availability,
    'reserved',
  );
  const competingSummary = (await api('/trades/mine', alice)).items.find(
    (t) => t.id === competing.id,
  );
  assert.equal(competingSummary.hasUnavailableItems, true);
  await alicePage.goto(`${origin}/swaps`);
  await expect(
    alicePage
      .locator('.swap-card')
      .filter({ has: alicePage.locator(`a[href="/swaps/${competing.id}"]`) }),
  ).toContainText('no longer available');
  await alicePage.goto(`${origin}/swaps/${cancelled.id}`);
  await expect(
    alicePage.getByRole('heading', {
      name: 'Agreement confirmed',
      includeHidden: true,
    }),
  ).toBeVisible();
  let release;
  let committed;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const didCommit = new Promise((resolve) => {
    committed = resolve;
  });
  await alicePage.route(`**/trades/${cancelled.id}/cancel`, async (route) => {
    const response = await route.fetch();
    committed();
    await gate;
    await route.fulfill({ response });
  });
  await lifecycle(alicePage)
    .getByRole('button', { name: 'Cancel confirmed swap' })
    .click();
  await alicePage
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await didCommit;
  await expect(
    alicePage.getByRole('button', { name: 'Checking and saving…' }),
  ).toBeDisabled();
  await expect(
    alicePage.getByRole('heading', {
      name: 'Agreement confirmed',
      includeHidden: true,
    }),
  ).toBeVisible();
  await expect(
    alicePage.getByText('Synthetic camera to Lifecycle Bob · reserved', {
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(lifecycle(alicePage)).toContainText('cancelled, not completed');
  await expect(
    alicePage.getByText('Synthetic camera to Lifecycle Bob', { exact: true }),
  ).toBeVisible();
  assert.equal(
    (await api(`/listings/${left.id}`, alice)).availability,
    'available',
  );
  assert.equal(
    (await api(`/trades/${cancelled.id}`, alice)).events.at(-1).eventType,
    'cancelled',
  );
  await capture(alicePage, 'cancelled');
  await alicePage.goto(`${origin}/swaps`);
  await expect(
    alicePage
      .locator('.swap-card')
      .filter({ has: alicePage.locator(`a[href="/swaps/${competing.id}"]`) }),
  ).not.toContainText('no longer available');

  // Outdated tab submits its exact reviewed version, then reads authoritative current terms.
  await bobPage.goto(`${origin}/swaps/${stale.id}`);
  await lifecycle(bobPage)
    .getByRole('button', { name: 'Decline proposal' })
    .click();
  await api(
    `/trades/${stale.id}`,
    alice,
    {
      expectedVersion: 1,
      participantIds: [alice.id, bob.id],
      transfers: [
        { listingId: left.id, ownerId: alice.id, recipientId: bob.id },
        { listingId: right.id, ownerId: bob.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 172800000).toISOString(),
    },
    'PUT',
  );
  await bobPage
    .getByRole('button', { name: 'Confirm decline', exact: true })
    .click();
  await expect(bobPage.getByRole('dialog')).toContainText('swap changed');
  await expect(
    bobPage.getByRole('button', { name: 'Confirm decline', exact: true }),
  ).toBeDisabled();
  assert.equal((await api(`/trades/${stale.id}`, bob)).status, 'proposed');
  await bobPage.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(
    bobPage.getByText('Proposed · Version 2', { exact: true }),
  ).toBeVisible();
  await lifecycle(bobPage)
    .getByRole('button', { name: 'Cancel proposal' })
    .click();
  await bobPage
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await expect(lifecycle(bobPage)).toContainText('cancelled, not completed');

  // A proposal becomes confirmed in another tab without a version change.
  await bobPage.goto(`${origin}/swaps/${sameVersion.id}`);
  await lifecycle(bobPage)
    .getByRole('button', { name: 'Cancel proposal' })
    .click();
  await expect(bobPage.getByRole('dialog')).toContainText(
    'No items are reserved by this proposal',
  );
  await accept(sameVersion.id, alice);
  await accept(sameVersion.id, bob);
  await bobPage
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await expect(bobPage.getByRole('dialog')).toContainText('swap changed');
  await expect(
    bobPage.getByRole('button', { name: 'Confirm cancellation', exact: true }),
  ).toBeDisabled();
  assert.equal(
    (await api(`/trades/${sameVersion.id}`, bob)).status,
    'confirmed',
  );
  assert.equal(
    (await api(`/listings/${left.id}`, alice)).availability,
    'reserved',
  );
  await bobPage.getByRole('button', { name: 'Go back', exact: true }).click();
  await lifecycle(bobPage)
    .getByRole('button', { name: 'Cancel confirmed swap' })
    .click();
  await expect(bobPage.getByRole('dialog')).toContainText(
    'before any reported handover or receipt',
  );
  await bobPage
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await expect(lifecycle(bobPage)).toContainText('cancelled, not completed');

  // A lost final acceptance can be replayed as confirmed after later cancellation.
  // The client must use the fresh detail, never that historical response status.
  await accept(replay.id, alice);
  await bobPage.goto(`${origin}/swaps/${replay.id}`);
  await bobPage.getByRole('button', { name: 'Review current terms' }).click();
  let acceptanceCommitted;
  const acceptanceSaved = new Promise((resolve) => {
    acceptanceCommitted = resolve;
  });
  await bobPage.route(
    `**/trades/${replay.id}/accept`,
    async (route) => {
      await route.fetch();
      acceptanceCommitted();
      await route.abort('failed');
    },
    { times: 1 },
  );
  const delayedDetail = await api(`/trades/${replay.id}`, bob);
  await bobPage.route(`**/trades/${replay.id}`, (route) =>
    route.fulfill({ json: delayedDetail }),
  );
  await bobPage
    .getByRole('button', { name: 'Accept version 1', exact: true })
    .click();
  await acceptanceSaved;
  await expect(
    bobPage.getByText(/Acceptance could not be verified/),
  ).toBeVisible();
  await api(
    `/trades/${replay.id}/cancel`,
    alice,
    { expectedVersion: 1 },
    'POST',
  );
  await bobPage.unroute(`**/trades/${replay.id}`);
  await bobPage
    .getByRole('button', { name: 'Accept version 1', exact: true })
    .click();
  await expect(lifecycle(bobPage)).toContainText('cancelled, not completed');
  await expect(
    bobPage.getByRole('heading', { name: 'Agreement confirmed' }),
  ).toHaveCount(0);
  assert.equal(
    (await api(`/listings/${left.id}`, alice)).availability,
    'available',
  );

  const notifications = (
    await fixture.migration.query(
      "SELECT id,resource_id FROM public.notifications WHERE recipient_id=$1 AND event_type='trade_status' ORDER BY created_at DESC",
      [bob.id],
    )
  ).rows;
  for (const [id, copy] of [
    [declined.id, 'declined this proposal'],
    [expired.id, 'proposal expired'],
    [cancelled.id, 'cancelled, not completed'],
  ]) {
    const notice = notifications.find((n) => n.resource_id === id);
    assert.ok(notice);
    await bobPage.goto(`${origin}/notifications/${notice.id}`);
    await expect(bobPage.getByText(new RegExp(copy))).toBeVisible();
    await expect(
      bobPage.getByRole('link', { name: 'View swap', exact: true }),
    ).toBeVisible();
    await expect(bobPage.getByText('Synthetic camera')).toHaveCount(0);
    if (id === cancelled.id)
      await capture(
        bobPage,
        'cancelled-notification',
        bobPage.getByRole('region', { name: 'Notification', exact: true }),
      );
  }
  const notice = notifications.find((n) => n.resource_id === cancelled.id);
  await outsider.goto(`${origin}/notifications/${notice.id}`);
  await expect(
    outsider.getByRole('link', { name: 'View swap', exact: true }),
  ).toHaveCount(0);
  await expect(outsider.getByText(/cancelled, not completed/)).toHaveCount(0);
  // An actual revision removes a member from a proposal; their original
  // recipient-only invitation remains without granting access to its target.
  const third = await item(stranger, 'Synthetic group book');
  const group = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: [alice.id, bob.id, stranger.id],
      transfers: [
        { listingId: left.id, ownerId: alice.id, recipientId: bob.id },
        { listingId: right.id, ownerId: bob.id, recipientId: stranger.id },
        { listingId: third.id, ownerId: stranger.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    'POST',
  );
  const invitationNotice = (
    await fixture.migration.query(
      "SELECT id FROM public.notifications WHERE recipient_id=$1 AND resource_id=$2 AND event_type='trade_invitation'",
      [bob.id, group.id],
    )
  ).rows[0];
  assert.ok(invitationNotice);
  await bobPage.goto(`${origin}/notifications/${invitationNotice.id}`);
  await expect(
    bobPage.getByText('Current swap status: proposed.', { exact: false }),
  ).toBeVisible();
  await api(
    `/trades/${group.id}`,
    alice,
    {
      expectedVersion: 1,
      participantIds: [alice.id, stranger.id],
      transfers: [
        { listingId: left.id, ownerId: alice.id, recipientId: stranger.id },
        { listingId: third.id, ownerId: stranger.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    'PUT',
  );
  await bobPage.reload();
  await expect(bobPage.getByText(/unavailable to this account/)).toBeVisible();
  await expect(bobPage.getByText(/Current swap status: proposed/)).toHaveCount(
    0,
  );
  await bobPage.getByRole('link', { name: 'View swap', exact: true }).click();
  await expect(
    bobPage.getByRole('heading', { name: 'Swap unavailable' }),
  ).toBeVisible();
  await expect(bobPage.getByText('Synthetic group book')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.info(
    'Real lifecycle browser journey passed: declined/expired/cancelled/history, separate coffee, held response, released availability, stale tab, historical confirmed acceptance replay, private notifications, revoked access, keyboard focus/trap, Light/Dark responsive and axe.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
