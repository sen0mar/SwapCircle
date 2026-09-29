// Synthetic local accounts; real Express/PostgreSQL and production UI. Only OAuth handoff is simulated.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;
const origin = 'http://127.0.0.1:4202';
const apiOrigin = 'http://127.0.0.1:4322';
const fixture = await createDiscoveryFixture(origin);
let server = fixture.app.listen(4322, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/composer-local/', import.meta.url);
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
const stopApi = async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};
const startApi = async () => {
  server = fixture.app.listen(4322, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
};
const bounded = (promise) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Journey request did not start/commit in time')),
        10000,
      );
      timer.unref();
      promise.finally(() => clearTimeout(timer));
    }),
  ]);
const endpoint = `${apiOrigin}/api/v1/conversations/messages`;
try {
  for (const [user, displayName] of [
    [alice, 'Composer Alice'],
    [bob, 'Composer Bob'],
    [stranger, 'Composer Stranger'],
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
      '4202',
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
  const screenshot = async (name) => {
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({
      path: new URL(name, output).pathname,
      fullPage: true,
    });
  };
  const history = (current) =>
    current.getByRole('region', { name: 'Message history' });
  const send = async (current, body) => {
    await current.getByLabel('Message draft').fill(body);
    await current.getByRole('button', { name: 'Send message' }).focus();
    await current.keyboard.press('Enter');
    // A prior same-body message may already be Sent. Wait for the new bubble's
    // persisted identity/status before a later scenario stops the API.
    const bubble = history(current)
      .getByRole('listitem')
      .filter({ has: current.getByText(body, { exact: true }) })
      .last();
    await expect(bubble).toHaveAttribute('data-message-order', /^\d+$/);
    await expect(bubble.getByText('Sent', { exact: true })).toBeVisible();
    await expect(
      current.getByRole('button', { name: 'Retry message' }),
    ).toHaveCount(0);
  };
  await send(page, 'Durable greeting');
  await peer.getByRole('button', { name: 'Refresh history' }).click();
  await expect(
    history(peer).getByText('Durable greeting', { exact: true }),
  ).toBeVisible();
  await send(peer, 'Durable reply');
  await page.getByRole('button', { name: 'Refresh history' }).click();
  await expect(
    history(page).getByText('Durable reply', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    history(page).getByText('Durable reply', { exact: true }),
  ).toBeVisible();

  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const body = `Interrupted ${theme} ${width}`;
      const payloads = [];
      let release;
      let intercepted;
      const seen = new Promise((resolve) => {
        intercepted = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.route(endpoint, async (route) => {
        payloads.push(route.request().postDataJSON());
        intercepted();
        await gate;
        await route.continue();
      });
      await page.getByLabel('Message draft').fill(body);
      await page.getByRole('button', { name: 'Send message' }).focus();
      await page.keyboard.press('Enter');
      await bounded(seen);
      await expect(
        history(page).getByText('Sending…', { exact: true }),
      ).toBeVisible();
      await screenshot(`${theme}-${width}-pending.png`);
      // Stop the actual Express listener while this production browser send is pending.
      await stopApi();
      release();
      await expect(
        page.getByRole('button', { name: 'Retry message' }),
      ).toBeVisible();
      await screenshot(`${theme}-${width}-failed.png`);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      await page
        .getByLabel('Message draft')
        .fill('A separate draft survives retry');
      await page.getByRole('link', { name: 'Browse', exact: true }).click();
      await page.getByRole('link', { name: 'Messages', exact: true }).click();
      await page
        .locator(`.conversation-list a[href="/inbox/${direct.id}"]`)
        .click();
      await expect(page.getByLabel('Message draft')).toHaveValue(
        'A separate draft survives retry',
      );
      await expect(
        page.getByRole('button', { name: 'Retry message' }),
      ).toBeVisible();
      await startApi();
      await page.getByRole('button', { name: 'Retry message' }).focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('button', { name: 'Retry message' }),
      ).toHaveCount(0);
      await expect(history(page).getByText(body, { exact: true })).toHaveCount(
        1,
      );
      assert.deepEqual(payloads[1], payloads[0]);
      await page.unroute(endpoint);
      await page.getByLabel('Message draft').fill('');
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      assert.ok(
        await page.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      await expect(
        page.getByRole('heading', { name: 'Composer Bob', exact: true }),
      ).toBeVisible();
      await screenshot(`${theme}-${width}-saved.png`);
    }
  }

  // Each first request really commits through Express/PostgreSQL, then its response
  // is withheld past the browser's 15s timeout. Also interrupt direct history reads
  // so Realtime/polling cannot confirm the save before the explicit recovery action.
  let allowRecoveryReads = false;
  const historyEndpoint = `${fixture.publicAuth.url}/rest/v1/messages?*`;
  await page.route(historyEndpoint, (route) =>
    allowRecoveryReads ? route.continue() : route.abort('failed'),
  );
  for (const refreshFirst of [false, true]) {
    allowRecoveryReads = false;
    const payloads = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let committed;
    const commit = new Promise((resolve) => {
      committed = resolve;
    });
    await page.route(endpoint, async (route) => {
      payloads.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.ok(response.ok());
      const result = await response.json();
      const row = await fixture.migration.query(
        'SELECT id FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
        [alice.id, payloads.at(-1).client_message_id],
      );
      assert.equal(row.rows.length, 1);
      assert.equal(row.rows[0].id, result.id);
      if (payloads.length === 1) {
        committed();
        await gate;
        try {
          await route.fulfill({ response });
        } catch {
          /* Timed-out browser request. */
        }
      } else await route.fulfill({ response });
    });
    const body = `Committed before lost response ${refreshFirst}`;
    await page.getByLabel('Message draft').fill(body);
    await page.getByRole('button', { name: 'Send message' }).click();
    await bounded(commit);
    await expect(
      history(page).getByText('Connecting… The API may be waking up.', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 5000 });
    await screenshot(`delayed-${refreshFirst}.png`);
    await expect(
      page.getByRole('button', { name: 'Retry message' }),
    ).toBeVisible({ timeout: 18000 });
    allowRecoveryReads = true;
    if (refreshFirst) {
      await page.getByRole('button', { name: 'Refresh history' }).click();
      await expect(
        page.getByRole('button', { name: 'Retry message' }),
      ).toHaveCount(0);
      assert.equal(payloads.length, 1);
    } else {
      await page.getByRole('button', { name: 'Retry message' }).click();
      await expect(
        page.getByRole('button', { name: 'Retry message' }),
      ).toHaveCount(0);
      assert.equal(payloads.length, 2);
      assert.deepEqual(payloads[1], payloads[0]);
      await page.getByRole('button', { name: 'Refresh history' }).click();
    }
    await expect(history(page).getByText(body, { exact: true })).toHaveCount(1);
    release();
    await page.unroute(endpoint);
    await peer.getByRole('button', { name: 'Refresh history' }).click();
    await expect(history(peer).getByText(body, { exact: true })).toHaveCount(1);
    const count = await fixture.migration.query(
      'SELECT count(*)::int AS count FROM public.messages WHERE sender_id=$1 AND client_message_id=$2',
      [alice.id, payloads[0].client_message_id],
    );
    assert.equal(count.rows[0].count, 1);
  }
  await page.unroute(historyEndpoint);
  // A fresh operation uses a fresh key even for identical body text.
  await send(page, 'Durable greeting');
  await expect(
    history(page).getByText('Durable greeting', { exact: true }),
  ).toHaveCount(2);
  await stopApi();
  await page.getByLabel('Message draft').fill('Private failed send');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    page.getByRole('button', { name: 'Retry message' }),
  ).toBeVisible();
  await page.getByLabel('Message draft').fill('Private unsent draft');
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  assert.ok(
    !(await page.locator('body').innerText()).includes('Private failed send'),
  );
  await startApi();
  await signIn(page, bob);
  await page.goto(`${origin}/inbox/${direct.id}`);
  await expect(page.getByLabel('Message draft')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Retry message' })).toHaveCount(
    0,
  );
  assert.ok(
    !(await page.locator('body').innerText()).includes('Private failed send'),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Production composer: two real isolated sessions exchanged durable messages, actual Express stop/restart retried exact payloads, real commits survived response timeouts with retry/refresh reconciliation, same-body messages stayed distinct, navigation retained drafts/failed sends, sign-out/account change cleared recovery. Pending/failed/saved Light/Dark narrow/desktop screenshots, keyboard and axe passed; synthetic fixtures cleaned up.',
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
  await stopApi();
  await fixture.cleanup();
}
