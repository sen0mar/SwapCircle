// Synthetic local accounts; real Express/PostgreSQL and production UI. Only OAuth handoff is simulated.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {
  createNotification,
  NotificationsRepository,
} from '../../api/dist/features/notifications/notifications.repository.js';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4206';
const apiOrigin = 'http://127.0.0.1:4326';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4326, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/notifications-local/', import.meta.url);
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
const signIn = async (page, user, destination = '/account') => {
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
  await page.goto(`${origin}${destination}`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(`${origin}${destination}`);
  if (destination === '/account')
    await expect(
      page.getByText('Your session is verified.', { exact: false }),
    ).toBeVisible();
};
const repository = new NotificationsRepository(fixture.runtime);
const seed = (
  user,
  event_type = 'trade_invitation',
  resource_type = 'trade',
  resource_id = randomUUID(),
) =>
  repository.transaction((client) =>
    createNotification(client, {
      recipient_id: user.id,
      domain_event_id: randomUUID(),
      event_type,
      resource_type,
      resource_id,
    }),
  );
const saved = async (id) =>
  (
    await fixture.runtime.query(
      'SELECT read_at FROM public.notifications WHERE id=$1',
      [id],
    )
  ).rows[0].read_at;
const seedGroup = async (id, active) => {
  const trade = randomUUID();
  const client = await fixture.migration.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO public.trades (id,creator_id,expires_at) VALUES ($1,$2,now()+interval '1 day')",
      [trade, bob.id],
    );
    await client.query(
      "INSERT INTO public.trade_versions (trade_id,version,created_by,participant_ids,expires_at) VALUES ($1,1,$2,$3,now()+interval '1 day')",
      [trade, bob.id, [alice.id, bob.id, stranger.id]],
    );
    await client.query(
      'INSERT INTO public.trade_participants (trade_id,user_id) VALUES ($1,$2),($1,$3),($1,$4)',
      [trade, alice.id, bob.id, stranger.id],
    );
    await client.query(
      "INSERT INTO public.conversations (id,type,trade_id) VALUES ($1,'group',$2)",
      [id, trade],
    );
    await client.query(
      "INSERT INTO public.conversation_members (conversation_id,user_id,active,status) VALUES ($1,$2,$5,$6),($1,$3,true,'accepted'),($1,$4,true,'accepted')",
      [
        id,
        alice.id,
        bob.id,
        stranger.id,
        active,
        active ? 'accepted' : 'pending',
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

try {
  for (const [user, displayName] of [
    [alice, 'Notification Alice'],
    [bob, 'Notification Bob'],
    [stranger, 'Notification Carol'],
  ])
    await api(
      '/profiles/me',
      user,
      { displayName, biography: '', approximateLocation: '', interestIds: [] },
      'PUT',
    );
  const direct = await api(
    '/conversations/direct',
    alice,
    { userId: bob.id },
    'POST',
  );
  await api(
    '/conversations/messages',
    bob,
    {
      conversation_id: direct.id,
      body: 'Separate ordinary unread message',
      client_message_id: randomUUID(),
    },
    'POST',
  );
  const authorizedGroup = randomUUID();
  await seedGroup(authorizedGroup, true);
  const conversation = await seed(
    alice,
    'group_invitation',
    'conversation',
    authorizedGroup,
  );
  const deferred = await seed(alice);
  const missing = await seed(alice, 'group_invitation', 'conversation');
  const peerId = await seed(bob, 'meeting_change', 'meetup');
  // Fixture notifications reference synthetic local resources; no production manufacturing endpoint.
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
      '4206',
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
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const deviceContext = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const device = await deviceContext.newPage();
  const errors = [];
  let readyTopics = new Set();
  let liveEvents = 0;
  let joins = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        const event = Array.isArray(frame) ? frame[3] : frame.event;
        const topic = Array.isArray(frame) ? frame[2] : frame.topic;
        if (
          event === 'phx_join' &&
          topic?.startsWith('realtime:notifications:')
        )
          joins++;
      } catch {
        /* Socket control frame. */
      }
    });
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        const event = Array.isArray(frame) ? frame[3] : frame.event;
        const topic = Array.isArray(frame) ? frame[2] : frame.topic;
        const data = Array.isArray(frame) ? frame[4] : frame.payload;
        if (!topic?.startsWith('realtime:notifications:')) return;
        if (event === 'system' && data?.status === 'ok') readyTopics.add(topic);
        if (event === 'postgres_changes') liveEvents++;
      } catch {
        /* Socket control frame. */
      }
    });
  });
  let releaseInitial;
  const initialRead = new Promise((resolve) => {
    releaseInitial = resolve;
  });
  await page.route('**/rest/v1/notifications?*', async (route) => {
    await initialRead;
    await route.continue();
  });
  await signIn(page, alice, `/notifications/${deferred}?source=bell#notice`);
  await expect(
    page.getByText('Loading notification…', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Open notifications, count unavailable',
      exact: true,
    }),
  ).toBeVisible();
  releaseInitial();
  await page.unroute('**/rest/v1/notifications?*');
  await expect(page.getByRole('link', { name: 'View swap' })).toBeVisible();
  await signIn(device, alice);
  await page.goto(`${origin}/inbox`);
  const bell = (current, count) =>
    current.getByRole('button', {
      name: `Open notifications, ${count} unread`,
      exact: true,
    });
  const panel = (current) =>
    current.getByRole('dialog', { name: 'Notifications', exact: true });
  const item = (current, id) =>
    panel(current).locator(`[data-notification-id="${id}"]`);
  await expect(bell(page, 3)).toBeVisible();
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  // Cold readiness: wait for the real replication-ready system frame, then
  // assert immediate seeded INSERT delivery without relying on focus or polling.
  await expect.poll(() => readyTopics.size).toBe(1);
  const beforeEvents = liveEvents;
  const live = await seed(alice, 'coffee_response', 'coffee_invitation');
  await expect.poll(() => liveEvents).toBeGreaterThan(beforeEvents);
  await expect(bell(page, 4)).toBeVisible();
  await bell(page, 4).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
  await expect(
    item(page, live).getByText('Coffee response', { exact: true }),
  ).toBeVisible();
  assert.equal(await saved(conversation), null);
  assert.equal(await saved(deferred), null);
  // Keyboard trap, background inertness, Escape and focus restoration.
  assert.ok(
    await page
      .locator('main')
      .evaluate((node) => Boolean(node.closest('[aria-hidden="true"]'))),
  );
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.ok(
      await panel(page).evaluate((node) =>
        node.contains(globalThis.document.activeElement),
      ),
    );
  }
  await page.keyboard.press('Escape');
  await expect(bell(page, 4)).toBeFocused();
  await bell(page, 4).click();
  await item(page, deferred).getByRole('link', { name: 'View swap' }).click();
  await expect(page).toHaveURL(/\/swaps\/[0-9a-f-]+$/);
  await expect(
    page.getByText('This swap cannot be found or you do not have access.'),
  ).toBeVisible();
  await page.goto(`${origin}/notifications/${deferred}`);
  await expect(page).toHaveURL(`${origin}/notifications/${deferred}`);
  await expect(page.getByRole('link', { name: 'View swap' })).toBeVisible();
  assert.equal(await saved(deferred), null);
  await page.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(bell(page, 3)).toBeVisible();
  const persistedAt = await saved(deferred);
  assert.ok(persistedAt);
  await page.reload();
  await expect(page.getByText('Read', { exact: true })).toBeVisible();
  assert.deepEqual(await saved(deferred), persistedAt);
  // Foreign IDs and arbitrary forged recipient filters remain denied by RLS.
  await page.goto(`${origin}/notifications/${peerId}`);
  await expect(
    page.getByText(
      'This notification cannot be found or you do not have access.',
      { exact: true },
    ),
  ).toBeVisible();
  const forged = await alice.client
    .from('notifications')
    .select('*')
    .eq('recipient_id', bob.id)
    .retry(false);
  assert.equal(forged.error, null);
  assert.deepEqual(forged.data, []);
  let outsiderEvents = 0;
  await bob.client.realtime.setAuth(bob.token);
  const malicious = bob.client
    .channel('forged-notification-filter', {
      config: { postgres_changes_options: { wait: true } },
    })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${alice.id}`,
      },
      () => outsiderEvents++,
    );
  await new Promise((resolve, reject) =>
    malicious.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error('Synthetic outsider subscription failed'));
    }),
  );
  await bell(page, 3).click();
  await item(page, missing)
    .getByRole('link', { name: 'View group invitation' })
    .click();
  await expect(
    page.getByText(
      'This group invitation is unavailable or you do not have access.',
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(await saved(missing), null);
  await bell(page, 3).click();
  await item(page, conversation)
    .getByRole('link', { name: 'View group invitation' })
    .click();
  await page.getByRole('link', { name: 'Open group conversation' }).click();
  await expect(page.getByLabel('Message draft')).toBeVisible();
  assert.equal(await saved(conversation), null);
  await expect(bell(page, 3)).toBeVisible();
  // Pending group invites do not grant membership/history or accept on navigation.
  const group = randomUUID();
  await seedGroup(group, false);
  const pendingId = await seed(
    alice,
    'group_invitation',
    'conversation',
    group,
  );
  await expect(bell(page, 4)).toBeVisible();
  await bell(page, 4).click();
  await item(page, pendingId)
    .getByRole('link', { name: 'View group invitation' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Join group chat' }),
  ).toBeVisible();
  await expect(page.getByLabel('Message draft')).toHaveCount(0);
  assert.equal(
    (
      await fixture.runtime.query(
        'SELECT active FROM public.conversation_members WHERE conversation_id=$1 AND user_id=$2',
        [group, alice.id],
      )
    ).rows[0].active,
    false,
  );
  // Read failures preserve unread and retry. Reads never update message progress.
  await bell(page, 4).click();
  await page.route('**/api/v1/notifications/read', (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: 'UNAVAILABLE',
          message: 'Synthetic test failure',
          requestId: randomUUID(),
        },
      },
    }),
  );
  await item(page, live).getByRole('button', { name: 'Mark read' }).click();
  await expect(
    item(page, live).getByRole('button', { name: 'Retry mark read' }),
  ).toBeVisible();
  assert.equal(await saved(live), null);
  await page.unroute('**/api/v1/notifications/read');
  await item(page, live)
    .getByRole('button', { name: 'Retry mark read' })
    .click();
  await expect(
    panel(page).getByText('3 unread notifications', { exact: true }),
  ).toBeVisible();
  assert.equal(
    (await api(`/conversations/${direct.id}/unread`, alice)).unreadCount,
    1,
  );
  // An acknowledgement can commit before its response is lost. Authoritative
  // reconciliation confirms the timestamp and clears the now-unneeded retry.
  const uncertain = await seed(alice, 'coffee_invitation', 'coffee_invitation');
  await expect(
    panel(page).getByText('4 unread notifications', { exact: true }),
  ).toBeVisible();
  await page.route('**/api/v1/notifications/read', async (route) => {
    const response = await route.fetch();
    assert.ok(response.ok());
    await route.abort('failed');
  });
  await item(page, uncertain)
    .getByRole('button', { name: 'Mark read' })
    .click();
  await expect(
    panel(page).getByText('3 unread notifications', { exact: true }),
  ).toBeVisible();
  await expect(
    item(page, uncertain).getByText('Read', { exact: true }),
  ).toBeVisible();
  await expect(
    item(page, uncertain).getByRole('button', { name: 'Retry mark read' }),
  ).toHaveCount(0);
  assert.ok(await saved(uncertain));
  await page.unroute('**/api/v1/notifications/read');
  // Mark-all >100: delay its first request while a new arrival is committed.
  for (let i = 0; i < 101; i++) await seed(alice, 'trade_revision');
  await expect(
    panel(page).getByText('104 unread notifications', { exact: true }),
  ).toBeVisible();
  const intended = (
    await fixture.runtime.query(
      'SELECT id FROM public.notifications WHERE recipient_id=$1 AND read_at IS NULL',
      [alice.id],
    )
  ).rows
    .map((row) => row.id)
    .sort();
  let release;
  const writes = [];
  let failAll = true;
  await page.route('**/api/v1/notifications/read-all', async (route) => {
    writes.push(route.request().postDataJSON().notification_ids);
    if (writes.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (failAll)
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'UNAVAILABLE',
            message: 'Synthetic test failure',
            requestId: randomUUID(),
          },
        },
      });
    else await route.continue();
  });
  await panel(page)
    .getByRole('button', { name: 'Mark all read', exact: true })
    .click();
  await expect.poll(() => Boolean(release)).toBe(true);
  const arrived = await seed(alice, 'meeting_change', 'meetup');
  await expect(
    panel(page).getByText('105 unread notifications', { exact: true }),
  ).toBeVisible();
  release();
  await expect(
    panel(page).getByRole('button', { name: 'Retry mark all read' }),
  ).toBeVisible();
  failAll = false;
  await panel(page)
    .getByRole('button', { name: 'Retry mark all read' })
    .click();
  await expect(
    panel(page).getByText('1 unread notifications', { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    writes.map((batch) => batch.length),
    [100, 100, 4],
  );
  assert.deepEqual(writes.slice(1).flat().sort(), intended);
  assert.equal(await saved(arrived), null);
  assert.equal(
    (await api(`/conversations/${direct.id}/unread`, alice)).unreadCount,
    1,
  );
  await page.unroute('**/api/v1/notifications/read-all');
  await expect(bell(device, 1)).toBeVisible();
  await page.route('**/api/v1/notifications/read-all', async (route) => {
    const response = await route.fetch();
    assert.ok(response.ok());
    await route.abort('failed');
  });
  await panel(page)
    .getByRole('button', { name: 'Mark all read', exact: true })
    .click();
  await expect(
    panel(page).getByText('0 unread notifications', { exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: 'Retry mark all read' }),
  ).toHaveCount(0);
  assert.ok(await saved(arrived));
  await page.unroute('**/api/v1/notifications/read-all');
  await seed(alice, 'coffee_response', 'coffee_invitation');
  await expect(
    panel(page).getByText('1 unread notifications', { exact: true }),
  ).toBeVisible();
  // Session token refresh keeps one subscription; normal route navigation also
  // keeps the shared-header connection and closes any open panel.
  const beforeJoins = joins;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Browse', exact: true }),
  ).toBeVisible();
  assert.equal(joins, beforeJoins);
  // Verified SDK token refresh updates a ready existing scoped channel.
  await alice.client.realtime.setAuth(alice.token);
  const refreshedIds = [];
  const refreshChannel = alice.client
    .channel('notification-refresh', {
      config: { postgres_changes_options: { wait: true } },
    })
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${alice.id}`,
      },
      (event) => refreshedIds.push(event.new.id),
    );
  await new Promise((resolve, reject) =>
    refreshChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error('Synthetic refresh subscription failed'));
    }),
  );
  assert.equal((await alice.client.auth.refreshSession()).error, null);
  const refreshed = await seed(alice, 'coffee_invitation', 'coffee_invitation');
  await expect
    .poll(() => refreshedIds.filter((id) => id === refreshed).length)
    .toBe(1);
  await expect(bell(page, 2)).toBeVisible();
  await alice.client.removeChannel(refreshChannel);
  // Offline transport recovery reconciles list/count and read changes from another device.
  await deviceContext.setOffline(true);
  const offline = await seed(alice, 'trade_status');
  await expect(bell(page, 3)).toBeVisible();
  await deviceContext.setOffline(false);
  await device.bringToFront();
  await device.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.Event('online')),
  );
  await expect(bell(device, 3)).toBeVisible();
  await bell(device, 3).click();
  await item(device, offline)
    .getByRole('button', { name: 'Mark read' })
    .click();
  await expect(bell(page, 2)).toBeVisible();
  await expect(
    panel(device).getByText('2 unread notifications', { exact: true }),
  ).toBeVisible();
  await device.getByRole('button', { name: 'Close', exact: true }).click();
  // Failed list refresh has an unavailable count and cannot consume cached IDs.
  await page.route('**/rest/v1/notifications?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Synthetic read outage' } }),
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.Event('online')),
  );
  await expect(
    page.getByRole('button', {
      name: 'Open notifications, count unavailable',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Open notifications, count unavailable',
      exact: true,
    })
    .click();
  await expect(
    panel(page).getByRole('button', {
      name: 'Retry notifications',
      exact: true,
    }),
  ).toBeVisible();
  await page.unroute('**/rest/v1/notifications?*');
  await panel(page)
    .getByRole('button', { name: 'Retry notifications', exact: true })
    .click();
  await expect(
    panel(page).getByText('2 unread notifications', { exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByText(
      'Notifications could not be refreshed. Please retry.',
      { exact: true },
    ),
  ).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        true,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await page.screenshot({
          path: new URL(`${theme}-panel-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto(`${origin}/inbox`);
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  await expect(bell(page, 2)).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      await page.screenshot({
        path: new URL(`${theme}-inbox-${width}.png`, output).pathname,
        fullPage: true,
      });
    }
  }
  // Same-browser tab sees durable private state and account transition cleanup.
  const tab = await context.newPage();
  await tab.goto(`${origin}/`);
  await expect(bell(tab, 2)).toBeVisible();
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /Open notifications/ }),
  ).toHaveCount(0);
  await expect(
    tab.getByRole('button', { name: /Open notifications/ }),
  ).toHaveCount(0);
  await signIn(page, stranger);
  await expect(bell(page, 0)).toBeVisible();
  await bell(page, 0).click();
  await expect(panel(page).getByText(/No notifications yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto(`${origin}/notifications/${deferred}`);
  await expect(
    page.getByText(
      'This notification cannot be found or you do not have access.',
      { exact: true },
    ),
  ).toBeVisible();
  assert.equal(outsiderEvents, 0);
  await bob.client.removeChannel(malicious);
  assert.deepEqual(errors, []);
  console.log(
    'Local notification production passed: cold-ready actual INSERT/UPDATE; recipient RLS/forged outsider filter; durable single/batched snapshot read and same-set retry/new-arrival exclusion; lost-response commit reconciliation; separate message count; authorized/missing/pending/deferred/foreign links without acceptance; keyboard trap/Escape/restore; offline reconnect/devices/tab/account cleanup; SDK auth refresh; loading/error/retry/empty; Light/Dark 360/768/800/1280/1600px overflow and axe.',
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
  for (const user of fixture.users) {
    await user.client?.removeAllChannels();
    await user.client?.realtime.disconnect();
  }
  await fixture.cleanup();
}
