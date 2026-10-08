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
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4205';
const apiOrigin = 'http://127.0.0.1:4325';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4325, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/unread-local/', import.meta.url);
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
    [alice, 'Unread Alice'],
    [bob, 'Unread Bob'],
    [stranger, 'Unread Carol'],
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
  const other = await api(
    '/conversations/direct',
    alice,
    { userId: stranger.id },
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
      '4205',
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
  const [context, otherContext] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [page, peer] = await Promise.all([
    context.newPage(),
    otherContext.newPage(),
  ]);
  const errors = [];
  for (const current of [page, peer])
    current.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, alice);
  await signIn(peer, bob);

  const thirdContext = await browser.newContext();
  const device = await thirdContext.newPage();
  await signIn(device, alice);
  const tab = await context.newPage();
  const send = async (user, id, body) =>
    api(
      '/conversations/messages',
      user,
      { conversation_id: id, body, client_message_id: randomUUID() },
      'POST',
    );
  const unread = async (id) =>
    (await api(`/conversations/${id}/unread`, alice)).unreadCount;
  await page.goto(`${origin}/inbox`);
  await send(bob, direct.id, 'Unopened incoming one');
  await send(bob, direct.id, 'Unopened incoming two');
  await send(alice, direct.id, 'Outgoing does not count');
  await send(stranger, other.id, 'Other conversation stays unread');
  await expect(page.getByText('2 unread', { exact: true })).toBeVisible();
  await expect(page.getByText('1 unread', { exact: true })).toBeVisible();
  assert.equal(await unread(direct.id), 2);
  // An Inbox list mount never acknowledges messages.
  await page.reload();
  await expect(page.getByText('2 unread', { exact: true })).toBeVisible();
  await tab.goto(`${origin}/inbox`);
  await device.goto(`${origin}/inbox`);
  await expect(tab.getByText('2 unread', { exact: true })).toBeVisible();
  await expect(device.getByText('2 unread', { exact: true })).toBeVisible();
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
          path: new URL(`${theme}-inbox-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  let peerReadEvents = 0;
  const malicious = bob.client.channel('malicious-peer-read-filter').on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'conversation_reads',
      filter: `user_id=eq.${alice.id}`,
    },
    () => peerReadEvents++,
  );
  await new Promise((resolve, reject) =>
    malicious.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error('Local read privacy subscription failed'));
    }),
  );
  await page.goto(`${origin}/inbox/${direct.id}`);
  await expect(page.getByLabel('Message draft')).toBeVisible();
  await expect.poll(() => unread(direct.id)).toBe(0);
  assert.equal(await unread(other.id), 1);
  await expect(tab.getByText('2 unread', { exact: true })).toHaveCount(0);
  await expect(device.getByText('2 unread', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Message draft')).toBeVisible();
  assert.equal(await unread(direct.id), 0);
  // A scrolled-away thread does not consume appended offscreen messages.
  for (let i = 0; i < 35; i++) await send(bob, direct.id, `Long history ${i}`);
  await expect.poll(() => unread(direct.id)).toBe(0);
  const region = page.getByRole('region', { name: 'Message history' });
  await region.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new globalThis.Event('scroll'));
  });
  await send(bob, direct.id, 'Offscreen incoming stays unread');
  await expect(
    page.getByText('Offscreen incoming stays unread', { exact: true }),
  ).toHaveCount(2);
  await expect.poll(() => unread(direct.id)).toBe(1);
  await region.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new globalThis.Event('scroll'));
  });
  await expect.poll(() => unread(direct.id)).toBe(0);
  // Transport disconnected from an unopened thread: durable counts and history recover.
  await device.goto(`${origin}/inbox`);
  await thirdContext.setOffline(true);
  await page.goto(`${origin}/inbox`);
  for (let i = 0; i < 4; i++) await send(bob, direct.id, `Missed unread ${i}`);
  await expect.poll(() => unread(direct.id)).toBe(4);
  await thirdContext.setOffline(false);
  await device.bringToFront();
  await device.evaluate(() =>
    globalThis.dispatchEvent(new globalThis.Event('online')),
  );
  await expect(device.getByText('4 unread', { exact: true })).toBeVisible();
  await device.goto(`${origin}/inbox/${direct.id}`);
  await expect(
    device
      .getByRole('region', { name: 'Message history' })
      .getByText('Missed unread 3', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => unread(direct.id)).toBe(0);
  await expect(page.getByText('4 unread', { exact: true })).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await device.emulateMedia({ colorScheme: theme });
    for (const width of [360, 768, 800, 1280, 1600]) {
      await device.setViewportSize({ width, height: 1000 });
      assert.equal(
        await device.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
        true,
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: device }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await device.screenshot({
          path: new URL(`${theme}-thread-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, stranger);
  await page.goto(`${origin}/inbox`);
  await expect(page.getByText('1 unread', { exact: true })).toHaveCount(0);
  assert.ok(
    !(await page.locator('body').innerText()).includes('Missed unread'),
  );
  assert.equal(peerReadEvents, 0);
  await bob.client.removeChannel(malicious);
  assert.deepEqual(errors, []);
  console.log(
    'Local unread production: incoming-only unopened Inbox counts; list reload does not acknowledge; visible thread clears only its own count; owner progress reaches same-browser tab and isolated device via actual Realtime; reload persists; offscreen incoming stays unread until scroll; disconnected list recovers four messages/count then visible thread clears; account isolation; Light/Dark Inbox/thread 360/768/800/1280/1600px overflow/axe passed.',
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
  for (const user of fixture.users) await user.client?.removeAllChannels();
  await fixture.cleanup();
}
