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

const origin = 'http://127.0.0.1:4208';
const apiOrigin = 'http://127.0.0.1:4328';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4328, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, carol, dan] = fixture.users;
const output = new URL('../test-results/groups-local/', import.meta.url);
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
  const names = ['Group Alice', 'Group Bob', 'Group Carol', 'Group Dan'];
  const items = [];
  for (const [index, user] of fixture.users.entries()) {
    await api(
      '/profiles/me',
      user,
      {
        displayName: names[index],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
    items.push(
      await api(
        '/listings',
        user,
        {
          title: `Group item ${index + 1}`,
          description: 'Synthetic local group item',
          condition: 'good',
        },
        'POST',
      ),
    );
  }
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
      '4208',
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

  const pages = await Promise.all(
    fixture.users.map(async () => (await browser.newContext()).newPage()),
  );
  const [a, b, c, d] = pages;
  const errors = [];
  for (const page of pages)
    page.on('pageerror', (error) => errors.push(error.message));
  const dm = await api(
    '/conversations/direct',
    alice,
    { userId: bob.id },
    'POST',
  );
  await api(
    '/conversations/messages',
    alice,
    {
      conversation_id: dm.id,
      body: 'Private DM stays separate',
      client_message_id: randomUUID(),
    },
    'POST',
  );
  await signIn(a, alice, `/listings/${items[1].id}`);
  await a.getByRole('button', { name: 'Propose a trade' }).click();
  await a
    .getByRole('combobox', { name: 'Add a person' })
    .selectOption(carol.id);
  await a.getByRole('combobox', { name: 'Add a person' }).selectOption(dan.id);
  for (const item of [items[0], items[2], items[3]])
    await a.getByRole('checkbox', { name: item.title, exact: true }).check();
  await a.getByRole('button', { name: 'Review proposal' }).click();
  await a.getByRole('button', { name: 'Send proposal' }).click();
  await expect(a).toHaveURL(/\/swaps\/[0-9a-f-]+$/);
  const tradeId = a.url().split('/').pop();
  const trade = await api(`/trades/${tradeId}`, alice);
  const group = trade.groupConversationId;
  assert.ok(group && group !== dm.id);
  await expect(
    a.getByRole('link', { name: 'Open group conversation' }),
  ).toBeVisible();
  for (const [index, page] of pages.entries()) {
    if (index) await signIn(page, fixture.users[index], `/groups/${group}`);
  }
  await expect(
    b.getByRole('button', { name: 'Join group chat' }),
  ).toBeVisible();
  await b.goto(`${origin}/inbox/${group}`);
  await expect(
    b.getByRole('heading', { name: 'Conversation unavailable' }),
  ).toBeVisible();
  const notification = (
    await bob.client
      .from('notifications')
      .select('id')
      .eq('resource_id', group)
      .eq('event_type', 'group_invitation')
  ).data[0];
  await b.goto(`${origin}/notifications/${notification.id}`);
  await b.getByRole('link', { name: 'View group invitation' }).click();
  await expect(b).toHaveURL(`${origin}/groups/${group}`);
  for (const theme of ['light', 'dark']) {
    await b.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await b.setViewportSize({ width, height: 1000 });
      assert.ok(
        await b.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: b }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await b.screenshot({
          path: new URL(`pending-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  await b.getByRole('button', { name: 'Join group chat' }).focus();
  await expect(
    b.getByRole('button', { name: 'Join group chat' }),
  ).toBeFocused();
  // Lost response before commit leaves the pending invitation actionable.
  await b.route(`**/conversations/${group}/invitation/accept`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'SYNTHETIC_FAILURE',
          message: 'Unavailable',
          requestId: 'synthetic',
        },
      },
    }),
  );
  await b.getByRole('button', { name: 'Join group chat' }).press('Enter');
  await expect(b.getByRole('alert')).toBeVisible();
  await b.unroute(`**/conversations/${group}/invitation/accept`);
  await b.getByRole('button', { name: 'Join group chat' }).press('Enter');
  await expect(b).toHaveURL(`${origin}/inbox/${group}`);
  for (const page of [c, d]) {
    await page.getByRole('button', { name: 'Join group chat' }).click();
    await expect(page).toHaveURL(`${origin}/inbox/${group}`);
  }
  await a.getByRole('link', { name: 'Open group conversation' }).click();
  for (const [index, page] of pages.entries()) {
    await page
      .getByRole('textbox', { name: 'Message draft' })
      .fill(`Four-person message ${index + 1}`);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(
      page
        .getByText(`Four-person message ${index + 1}`, { exact: true })
        .first(),
    ).toBeVisible();
  }
  for (const page of pages) {
    await page.getByRole('button', { name: 'Refresh history' }).click();
    for (let index = 1; index <= 4; index++)
      await expect(
        page
          .getByRole('region', { name: 'Message history' })
          .getByText(`Four-person message ${index}`, { exact: true }),
      ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Message history' })
        .getByText('Private DM stays separate', { exact: true }),
    ).toHaveCount(0);
  }
  const unchanged = await api(`/trades/${tradeId}`, bob);
  assert.equal(unchanged.status, 'proposed');
  assert.ok(
    unchanged.participants.every((person) => person.acceptedVersion === null),
  );
  await b.goto(`${origin}/inbox/${dm.id}`);
  await expect(
    b
      .getByRole('region', { name: 'Message history' })
      .getByText('Private DM stays separate', { exact: true }),
  ).toBeVisible();
  await b.goto(`${origin}/inbox/${group}`);
  // A second device keeps the open thread and a draft until revocation is discovered.
  const second = await (await browser.newContext()).newPage();
  await signIn(second, bob, `/inbox/${group}`);
  await second
    .getByRole('textbox', { name: 'Message draft' })
    .fill('Revoked draft');
  await b
    .getByText('Participants and chat membership', { exact: true })
    .press('Enter');
  await b.getByRole('button', { name: 'Leave group chat' }).click();
  await expect(b.getByText(/memory or devices/)).toBeVisible();
  await b
    .getByRole('button', { name: 'Confirm leave group chat' })
    .press('Enter');
  await expect(b).toHaveURL(`${origin}/groups/${group}`);
  await expect(
    b.getByText(/You cannot read or send group messages/),
  ).toBeVisible();
  await second.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.Event('focus')),
  );
  await expect(
    second.getByRole('heading', { name: 'Conversation unavailable' }),
  ).toBeVisible();
  await expect(
    second.getByText('Four-person message 1', { exact: true }),
  ).toHaveCount(0);
  await expect(
    second.getByRole('textbox', { name: 'Message draft' }),
  ).toHaveCount(0);
  await a
    .getByRole('textbox', { name: 'Message draft' })
    .fill('After leave, active members only');
  await a.getByRole('button', { name: 'Send message' }).click();
  await c.getByRole('button', { name: 'Refresh history' }).click();
  await expect(
    c
      .getByRole('region', { name: 'Message history' })
      .getByText('After leave, active members only', { exact: true }),
  ).toBeVisible();
  await b.goto(`${origin}/inbox/${dm.id}`);
  await expect(
    b
      .getByRole('region', { name: 'Message history' })
      .getByText('Private DM stays separate', { exact: true }),
  ).toBeVisible();
  // Separate four-person proposal: one declines chat without changing the terms.
  const declinedTrade = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: fixture.users.map((user) => user.id),
      transfers: items.map((item, index) => ({
        listingId: item.id,
        ownerId: fixture.users[index].id,
        recipientId: fixture.users[(index + 1) % 4].id,
      })),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      meetingMode: 'meet_to_swap',
    },
    'POST',
  );
  const declinedDetail = await api(`/trades/${declinedTrade.id}`, alice);
  await d.goto(`${origin}/groups/${declinedDetail.groupConversationId}`);
  await d.getByRole('button', { name: 'Decline group chat' }).click();
  await expect(
    d.getByText(/You cannot read or send group messages/),
  ).toBeVisible();
  await d.goto(`${origin}/swaps/${declinedTrade.id}`);
  await expect(d.getByText('Group Dan · Declined chat')).toBeVisible();
  assert.ok(
    (await api(`/trades/${declinedTrade.id}`, dan)).participants.every(
      (person) => person.acceptedVersion === null,
    ),
  );
  for (const [label, page, destination] of [
    ['invitation', d, `/groups/${declinedDetail.groupConversationId}`],
    ['thread', c, `/inbox/${group}`],
    ['terms', a, `/swaps/${tradeId}`],
  ]) {
    await page.goto(`${origin}${destination}`);
    await expect(
      page.getByRole('heading', {
        name:
          label === 'thread'
            ? 'Group conversation'
            : label === 'terms'
              ? 'Swap proposal'
              : 'Group invitation',
        exact: true,
      }),
    ).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      for (const width of [360, 768, 800, 1280, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
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
            path: new URL(`${label}-${theme}-${width}.png`, output).pathname,
            fullPage: true,
          });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    'Local group UI passed: four real sessions, UI proposal, notification, pending denial, join/failure/decline/leave, independent consent, four-person messages, separate DM, cross-device revocation, both themes, responsive and axe checks.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
