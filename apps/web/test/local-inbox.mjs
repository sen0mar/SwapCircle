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
const origin = 'http://127.0.0.1:4200';
const apiOrigin = 'http://127.0.0.1:4320';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4320, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/inbox-local/', import.meta.url);
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
    [stranger, 'Local Stranger'],
    [fixture.users[3], 'Local Empty Peer'],
  ])
    await api(
      '/profiles/me',
      user,
      {
        displayName,
        biography: 'Synthetic public profile.',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
  const item = await api(
    '/listings',
    bob,
    {
      title: 'Inbox field guide',
      description: 'Synthetic item.',
      condition: 'good',
    },
    'POST',
  );
  const direct = await api(
    '/conversations/direct',
    alice,
    { userId: bob.id },
    'POST',
  );
  for (let i = 1; i <= 65; i++)
    await fixture.migration.query(
      'INSERT INTO public.messages (conversation_id,sender_id,body,client_message_id,message_order) VALUES ($1,$2,$3,$4,1)',
      [
        direct.id,
        i % 2 ? alice.id : bob.id,
        i === 65
          ? '<script>Stored plain text</script>'
          : `History ${String(i).padStart(2, '0')}`,
        randomUUID(),
      ],
    );
  const empty = await api(
    '/conversations/direct',
    alice,
    { userId: fixture.users[3].id },
    'POST',
  );
  // Bounded list pagination, including exact creation-time ties; these are seeded histories only.
  for (let i = 0; i < 21; i++) {
    const group = await fixture.migration.query(
      "INSERT INTO public.conversations(type,created_at) VALUES ('group','2020-01-01T00:00:00Z') RETURNING id",
    );
    await fixture.migration.query(
      'INSERT INTO public.conversation_members(conversation_id,user_id) VALUES ($1,$2)',
      [group.rows[0].id, alice.id],
    );
  }
  // PostgREST can briefly report a newly issued local JWT as issued in the future.
  // Wait for real authorized readiness; never replace the token or bypass RLS.
  for (const user of [alice, bob, stranger]) {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await user.client
        .from('conversations')
        .select('id')
        .limit(1)
        .retry(false);
      if (!result.error) {
        ready = true;
        break;
      }
      assert.ok(
        result.error.code === 'PGRST303' &&
          result.error.message.toLowerCase().includes('future'),
        `Local history readiness rejected with ${result.error.code}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Local JWT history-read readiness did not stabilize');
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
      '4200',
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
  const contexts = await Promise.all(
    [alice, bob, stranger].map(() => browser.newContext()),
  );
  const [page, otherPage, outsider] = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const errors = [];
  for (const current of [page, otherPage, outsider])
    current.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, alice);
  await signIn(otherPage, bob);
  await signIn(outsider, stranger);
  await page.goto(`${origin}/members/${bob.id}`);
  await page.getByRole('button', { name: 'Message', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/inbox/${direct.id}`);
  await expect(
    page
      .getByRole('region', { name: 'Message history' })
      .getByText('<script>Stored plain text</script>'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Local Bob', exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel('Message draft')).toBeVisible();
  await page.getByLabel('Message draft').fill('Unsent synthetic draft');
  await expect(
    page.getByRole('button', { name: 'Send unavailable' }),
  ).toBeDisabled();
  const scroll = page.getByRole('region', { name: 'Message history' });
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  const before = await page
    .locator('[data-message-order="36"]')
    .evaluate((element) => element.getBoundingClientRect().top);
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.locator('[data-message-order]')).toHaveCount(60);
  const after = await page
    .locator('[data-message-order="36"]')
    .evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(
    Math.abs(before - after) <= 2,
    `Scroll anchor moved ${Math.abs(before - after)}px`,
  );
  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.locator('[data-message-order]')).toHaveCount(65);
  const orders = await page
    .locator('[data-message-order]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        Number(element.getAttribute('data-message-order')),
      ),
    );
  assert.deepEqual(
    orders,
    Array.from({ length: 65 }, (_, i) => i + 1),
  );
  await expect(
    page.getByRole('button', { name: 'Load older messages' }),
  ).toHaveCount(0);
  assert.equal(await scroll.locator('script').count(), 0);
  await page.screenshot({
    path: new URL('older-history.png', output).pathname,
    fullPage: true,
  });
  // Actual production Supabase responses are authorized by each independent session.
  await otherPage.goto(`${origin}/members/${alice.id}`);
  await otherPage.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(otherPage).toHaveURL(`${origin}/inbox/${direct.id}`);
  await expect(
    otherPage
      .getByRole('region', { name: 'Message history' })
      .getByText('<script>Stored plain text</script>'),
  ).toBeVisible();
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT count(*)::int AS count FROM public.messages WHERE conversation_id=$1',
        [direct.id],
      )
    ).rows[0].count,
    65,
  );
  await outsider.goto(`${origin}/inbox/${direct.id}`);
  await expect(outsider.getByRole('alert')).toContainText('do not have access');
  await expect(
    outsider.getByRole('region', { name: 'Message history' }),
  ).toHaveCount(0);
  await expect(outsider.getByLabel('Message draft')).toHaveCount(0);
  assert.ok(
    !(await outsider.locator('body').innerText()).includes('Stored plain text'),
  );
  await outsider.screenshot({
    path: new URL('stranger-denied.png', output).pathname,
    fullPage: true,
  });
  for (const theme of ['light', 'dark']) {
    await outsider.emulateMedia({ colorScheme: theme });
    for (const width of [360, 1280]) {
      await outsider.setViewportSize({ width, height: 1000 });
      await outsider.goto(`${origin}/inbox/${direct.id}`);
      await expect(outsider.getByRole('alert')).toContainText(
        'do not have access',
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: outsider }).analyze()).violations,
        [],
      );
      await outsider.screenshot({
        path: new URL(`${theme}-${width}-denied.png`, output).pathname,
        fullPage: true,
      });
    }
  }
  await outsider.goto(`${origin}/inbox`);
  await expect(
    outsider.getByText('No conversations yet.', { exact: false }),
  ).toBeVisible();
  // Reload/deep links and list pagination retain unique stable URLs.
  await page.getByRole('link', { name: 'Back to conversations' }).click();
  await expect(page.locator('.conversation-list li')).toHaveCount(20);
  await page.getByRole('button', { name: 'More conversations' }).click();
  await expect(page.locator('.conversation-list li')).toHaveCount(23);
  const links = await page
    .locator('.conversation-list a')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
  assert.equal(new Set(links).size, 23);
  await page.locator(`.conversation-list a[href="/inbox/${empty.id}"]`).click();
  await expect(
    page.getByText('No messages yet.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-message-order]')).toHaveCount(0);
  await page.screenshot({
    path: new URL('empty-thread.png', output).pathname,
    fullPage: true,
  });
  await page
    .locator(`.conversation-list a[href="/inbox/${direct.id}"]`)
    .click();
  await expect(page.getByLabel('Message draft')).toHaveValue(
    'Unsent synthetic draft',
  );
  await page.reload();
  await expect(page.getByLabel('Message draft')).toHaveValue('');
  // Listing and discovery actions start/open the same canonical DM without interests/trades.
  await page.goto(`${origin}/listings/${item.id}`);
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/inbox/${direct.id}`);
  await page.goto(origin);
  const card = page.locator('.member-preview').filter({
    has: page.getByRole('link', { name: 'Local Bob', exact: true }),
  });
  await card.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/inbox/${direct.id}`);
  // Network failure is recoverable and never shows fabricated successful history.
  await page.route(`${fixture.publicAuth.url}/rest/v1/messages?*`, (route) =>
    new URL(route.request().url()).searchParams.get('limit') === '31'
      ? route.abort('failed')
      : route.continue(),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'History could not be loaded',
  );
  await page.unroute(`${fixture.publicAuth.url}/rest/v1/messages?*`);
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page.getByLabel('Message draft')).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${origin}/inbox`);
      await expect(page.locator('.conversation-list li')).toHaveCount(20);
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
          path: new URL(`${theme}-${width}-list.png`, output).pathname,
          fullPage: true,
        });
      if (width >= 768) {
        const list = page.getByRole('region', {
          name: 'Conversations',
          exact: true,
        });
        await list.focus();
        await page.keyboard.press('End');
        await expect
          .poll(() => list.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
        assert.ok(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollHeight < 1300,
          ),
        );
      }
      const link = page.locator(
        `.conversation-list a[href="/inbox/${direct.id}"]`,
      );
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('heading', { name: 'Local Bob', exact: true }),
      ).toBeFocused();
      await expect(page.getByLabel('Message draft')).toBeVisible();
      await expect(
        page
          .getByRole('region', { name: 'Message history' })
          .getByText('<script>Stored plain text</script>'),
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
      if (width === 360) await expect(page.locator('.inbox-list')).toBeHidden();
      else await expect(page.locator('.inbox-list')).toBeVisible();
      if ([360, 1280].includes(width))
        await page.screenshot({
          path: new URL(`${theme}-${width}-thread.png`, output).pathname,
          fullPage: true,
        });
      await page.getByRole('link', { name: 'Back to conversations' }).click();
      await expect(page).toHaveURL(`${origin}/inbox`);
    }
  }
  // Revoke membership and revalidate: cached history must not survive denied access.
  await fixture.migration.query(
    'UPDATE public.conversation_members SET active=false WHERE conversation_id=$1 AND user_id=$2',
    [direct.id, alice.id],
  );
  await page.goto(`${origin}/inbox/${direct.id}`);
  await expect(page.getByRole('alert')).toContainText('do not have access');
  await expect(page.getByLabel('Message draft')).toHaveCount(0);
  await page.goto(`${origin}/members/${bob.id}`);
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  // Change identity in the same browser: no prior inbox/history/draft may flash.
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page
      .getByRole('banner')
      .getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await signIn(page, stranger);
  await page.goto(`${origin}/inbox/${direct.id}`);
  await expect(page.getByRole('alert')).toContainText('do not have access');
  await expect(page.locator('.conversation-list li')).toHaveCount(0);
  await expect(page.getByLabel('Message draft')).toHaveCount(0);
  assert.ok(
    !(await page.locator('body').innerText()).includes('Stored plain text'),
  );
  await outsider.goto(`${origin}/inbox/${direct.id}`);
  await outsider
    .getByRole('button', { name: 'Open account', exact: true })
    .click();
  await outsider.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    outsider.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  assert.ok(
    new URL(outsider.url()).searchParams.get('next').includes(direct.id),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Local inbox: production build, three real isolated sessions, canonical profile/listing/discovery DM entry without interests/trades, same-browser identity cleanup, bounded tied list cursors and keyboard scrolling, 65 ordered plain-text messages, older-history scroll anchor, empty/denied/revoked/unavailable recovery, unsent drafts, stable reloads and signed-out deep links passed. Light/Dark desktop/mobile, keyboard and axe checks at 360/768/800/1280/1600px passed. Synthetic data cleaned up.',
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
