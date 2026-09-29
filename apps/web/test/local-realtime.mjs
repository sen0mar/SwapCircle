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
const origin = 'http://127.0.0.1:4204';
const apiOrigin = 'http://127.0.0.1:4324';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4324, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/realtime-local/', import.meta.url);
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
    [alice, 'Realtime Alice'],
    [bob, 'Realtime Bob'],
    [stranger, 'Realtime Stranger'],
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
  for (const user of [alice, bob]) {
    let authorized = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await user.client
        .from('conversations')
        .select('id')
        .limit(1)
        .retry(false);
      if (!result.error) {
        authorized = true;
        break;
      }
      assert.ok(
        result.error.code === 'PGRST303' &&
          result.error.message.toLowerCase().includes('future'),
        `Local read readiness failed: ${result.error.code}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(authorized);
  }
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
      '4204',
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
  for (const current of [page, peer]) {
    await current.goto(`${origin}/inbox/${direct.id}`);
    await expect(current.getByLabel('Message draft')).toBeVisible();
  }
  let peerEvents = 0;
  let peerReady = false;
  // Count actual Postgres Changes frames without recording private payloads.
  const countFrames = (socket) =>
    socket.on('framereceived', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        const event = Array.isArray(frame) ? frame[3] : frame.event;
        const data = Array.isArray(frame) ? frame[4] : frame.payload;
        const topic = Array.isArray(frame) ? frame[2] : frame.topic;
        if (topic !== `realtime:inbox:${bob.id}:${direct.id}`) return;
        if (event === 'postgres_changes') peerEvents++;
        if (event === 'system' && data?.status === 'ok') peerReady = true;
      } catch {
        /* Non-JSON control frame. */
      }
    });
  peer.on('websocket', countFrames);
  // Start observation before the production subscription is opened.
  await peer.reload();
  await expect(peer.getByLabel('Message draft')).toBeVisible();
  const history = (current) =>
    current.getByRole('region', { name: 'Message history' });
  const send = async (current, body) => {
    await current.getByLabel('Message draft').fill(body);
    await current.getByRole('button', { name: 'Send message' }).click();
    await expect(history(current).getByText(body, { exact: true })).toHaveCount(
      1,
    );
  };
  // A deliberately targeted outsider channel must receive no private messages.
  let outsiderEvents = 0;
  const outsiderChannel = stranger.client.channel('malicious-local-filter').on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${direct.id}`,
    },
    () => outsiderEvents++,
  );
  await new Promise((resolve, reject) =>
    outsiderChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error('Outsider subscription failed'));
    }),
  );
  await expect.poll(() => peerReady, { timeout: 15000 }).toBe(true);
  await send(page, 'Live greeting');
  await expect(
    history(peer).getByText('Live greeting', { exact: true }),
  ).toHaveCount(1);
  await expect.poll(() => peerEvents).toBeGreaterThan(0);
  await send(peer, 'Live reply');
  await expect(
    history(page).getByText('Live reply', { exact: true }),
  ).toHaveCount(1);
  // The persisted event confirms the save before the Express response is released.
  const endpoint = `${apiOrigin}/api/v1/conversations/messages`;
  let releaseReceipt;
  const receiptGate = new Promise((resolve) => {
    releaseReceipt = resolve;
  });
  await page.route(endpoint, async (route) => {
    const response = await route.fetch();
    assert.ok(response.ok());
    await receiptGate;
    await route.fulfill({ response });
  });
  await send(page, 'Event before response');
  await expect(
    history(page)
      .getByText('Event before response', { exact: true })
      .locator('..')
      .getByText('Sent', { exact: true }),
  ).toBeVisible();
  const receiptResponse = page.waitForResponse(endpoint);
  releaseReceipt();
  await receiptResponse;
  await page.unroute(endpoint);
  await expect(
    history(page).getByText('Event before response', { exact: true }),
  ).toHaveCount(1);
  await expect(
    history(peer).getByText('Event before response', { exact: true }),
  ).toHaveCount(1);
  await expect(peer.locator('[data-message-order]')).toHaveCount(3);
  // Real transport loss; > one recovery page must arrive in server order.
  await otherContext.setOffline(true);
  for (let i = 1; i <= 35; i++)
    await api(
      '/conversations/messages',
      alice,
      {
        conversation_id: direct.id,
        body: `Missed ${i}`,
        client_message_id: randomUUID(),
      },
      'POST',
    );
  await expect(
    history(peer).getByText('Missed 35', { exact: true }),
  ).toHaveCount(0);
  await otherContext.setOffline(false);
  await expect(
    history(peer).getByText('Missed 35', { exact: true }),
  ).toHaveCount(1);
  await expect(peer.locator('[data-message-order]')).toHaveCount(38);
  const orders = await peer
    .locator('[data-message-order]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        Number(element.getAttribute('data-message-order')),
      ),
    );
  assert.deepEqual(
    orders,
    Array.from({ length: 38 }, (_, i) => i + 1),
  );
  await send(page, 'After reconnect');
  await expect(
    history(peer).getByText('After reconnect', { exact: true }),
  ).toHaveCount(1);
  // SDK auth refresh must update an existing channel, without opening another.
  const refreshedEvents = [];
  const refreshedChannel = bob.client.channel('local-refresh-verification').on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${direct.id}`,
    },
    (event) => refreshedEvents.push(event.new.id),
  );
  await new Promise((resolve, reject) =>
    refreshedChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
        reject(new Error('Refresh subscription failed'));
    }),
  );
  assert.equal((await bob.client.auth.refreshSession()).error, null);
  const refreshedReceipt = page.waitForResponse(endpoint);
  await send(page, 'After auth refresh');
  const refreshedResponse = await refreshedReceipt;
  assert.ok(refreshedResponse.ok());
  const refreshedMessage = await refreshedResponse.json();
  // The tenant's WAL catch-up may deliver older commits to this new channel.
  // Require exactly one event for the actual post-refresh save on the same channel.
  await expect
    .poll(
      () => refreshedEvents.filter((id) => id === refreshedMessage.id).length,
    )
    .toBe(1);
  for (const current of [page, peer]) {
    await expect(
      history(current).getByText('After auth refresh', { exact: true }),
    ).toHaveCount(1);
    await expect(
      current.locator(`[data-message-id="${refreshedMessage.id}"]`),
    ).toHaveCount(1);
  }
  assert.equal(outsiderEvents, 0);
  await stranger.client.removeChannel(outsiderChannel);
  await bob.client.removeChannel(refreshedChannel);
  // A revocation is received while the thread remains open; cached history disappears.
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
    [direct.id, bob.id],
  );
  await expect(peer.getByRole('alert')).toContainText('do not have access');
  await expect(peer.locator('[data-message-order]')).toHaveCount(0);
  await expect(peer.getByLabel('Message draft')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 360, height: 1000 });
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({
      path: new URL(`${theme}-live.png`, output).pathname,
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, stranger);
  await page.goto(`${origin}/inbox/${direct.id}`);
  await expect(page.getByRole('alert')).toContainText('do not have access');
  assert.ok(
    !(await page.locator('body').innerText()).includes('Live greeting'),
  );
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=true WHERE conversation_id=$1 AND user_id=$2',
    [direct.id, bob.id],
  );
  await api(
    '/conversations/messages',
    alice,
    {
      conversation_id: direct.id,
      body: 'Old account event',
      client_message_id: randomUUID(),
    },
    'POST',
  );
  await expect(
    page.getByText('Old account event', { exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'Local Realtime: production UI live sends in two isolated sessions with actual Postgres Changes frames and event-before-response reconciliation; offline transport plus 35-message ordered paginated recovery; live delivery after reconnect; refreshed auth on an existing SDK channel; malicious outsider filter receives zero events; open-thread membership revocation clears history; same-browser account isolation; mobile Light/Dark axe passed. Synthetic data cleaned up.',
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
