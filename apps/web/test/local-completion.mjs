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
const output = new URL('../test-results/completion-local/', import.meta.url);
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
  const interestIds = interests.slice(0, 2).map((i) => i.id);
  for (const [index, user] of users.entries())
    await api(
      '/profiles/me',
      user,
      {
        displayName: ['Receipt Alice', 'Receipt Bob', 'Receipt Carol'][index],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds,
      },
      'PUT',
    );
  const make = async (members) => {
    const transfers = [];
    for (const [index, user] of members.entries()) {
      const item = await api(
        '/listings',
        user,
        {
          title: `Receipt item ${index + 1}`,
          description: 'Synthetic receipt item',
          condition: 'good',
        },
        'POST',
      );
      transfers.push({
        listingId: item.id,
        ownerId: user.id,
        recipientId: members[(index + 1) % members.length].id,
      });
    }
    const trade = await api(
      '/trades',
      alice,
      {
        operationKey: randomUUID(),
        participantIds: members.map((u) => u.id),
        transfers,
        meetingMode: 'meet_to_swap',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      'POST',
    );
    for (const user of members)
      await api(
        `/trades/${trade.id}/accept`,
        user,
        { operationKey: randomUUID(), expectedVersion: 1 },
        'POST',
      );
    return trade;
  };
  const direct = await make([alice, bob]);
  const group = await make(users);
  const problem = await make([alice, bob]);
  const stale = await make([alice, bob]);
  const coffeeDecision = async (trade, invitee, action) => {
    const invitation = await api(
      `/trades/${trade.id}/coffee`,
      alice,
      { inviteeId: invitee.id, operationKey: randomUUID(), offerToPay: false },
      'POST',
    );
    await api(
      `/trades/${trade.id}/coffee/${invitation.id}/respond`,
      invitee,
      { action },
      'POST',
    );
  };
  await coffeeDecision(direct, bob, 'decline');
  await coffeeDecision(group, stranger, 'accept');
  await coffeeDecision(problem, bob, 'accept');
  const groupCoffee = await api(`/trades/${group.id}/coffee`, alice);
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
    await browser.newContext({
      reducedMotion: 'reduce',
      timezoneId: 'Europe/Paris',
    })
  ).newPage();
  const bobPage = await (
    await browser.newContext({
      reducedMotion: 'reduce',
      timezoneId: 'America/New_York',
    })
  ).newPage();
  const outsider = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, outsider])
    page.on('pageerror', (e) => errors.push(e.message));

  const lifecycle = (page) =>
    page.getByRole('region', { name: 'Receipt and problems' });
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

  const carolPage = outsider;
  await signIn(alicePage, alice, `/swaps/${direct.id}`);
  await signIn(bobPage, bob, `/swaps/${direct.id}`);
  await signIn(carolPage, stranger, `/swaps/${group.id}`);
  const receipt = async (page) => {
    await lifecycle(page)
      .getByRole('button', { name: 'Confirm my receipt' })
      .click();
    await page.getByRole('button', { name: 'I received all my items' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(lifecycle(page)).toContainText(
      'Your receipt acknowledgement was saved.',
    );
  };
  const refresh = async (page) => {
    await page.getByRole('button', { name: 'Refresh swap status' }).click();
  };
  const coffeeBefore = await api(`/trades/${direct.id}/coffee`, alice);
  await capture(alicePage, 'confirmed');
  // Keyboard dialog trap, Escape and focus restoration in both themes.
  for (const theme of ['light', 'dark']) {
    await alicePage.getByLabel('Theme').selectOption(theme);
    const button = lifecycle(alicePage).getByRole('button', {
      name: 'Confirm my receipt',
    });
    await button.focus();
    await alicePage.keyboard.press('Enter');
    await expect(alicePage.getByRole('dialog')).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await alicePage.keyboard.press('Tab');
      assert.ok(
        await alicePage
          .getByRole('dialog')
          .evaluate((el) => el.contains(globalThis.document.activeElement)),
      );
    }
    await alicePage.keyboard.press('Escape');
    await expect(button).toBeFocused();
  }
  // Actual committed receipt with a lost browser response and retained retry key.
  const receiptBodies = [];
  await alicePage.route(`**/trades/${direct.id}/receipt`, async (route) => {
    receiptBodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (receiptBodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await lifecycle(alicePage)
    .getByRole('button', { name: 'Confirm my receipt' })
    .click();
  await alicePage
    .getByRole('button', { name: 'I received all my items' })
    .click();
  await expect(
    alicePage.getByText(/The outcome could not be verified/),
  ).toBeVisible();
  await alicePage.getByRole('button', { name: 'Go back' }).click();
  await alicePage
    .getByRole('button', { name: 'Review saved submission' })
    .click();
  await alicePage
    .getByRole('button', { name: 'Retry same submission' })
    .click();
  await expect(alicePage.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(receiptBodies[0], receiptBodies[1]);
  let detail = await api(`/trades/${direct.id}`, alice);
  assert.equal(detail.status, 'confirmed');
  assert.equal(
    detail.events.filter((e) => e.eventType === 'receipt_acknowledged').length,
    1,
  );
  await expect(lifecycle(alicePage)).toContainText(
    'Receipt Bob · Receipt pending',
  );
  await expect(
    alicePage.getByRole('button', { name: 'Cancel confirmed swap' }),
  ).toBeDisabled();
  await capture(alicePage, 'direct-pending');
  await receipt(bobPage);
  await refresh(alicePage);
  await expect(lifecycle(alicePage)).toContainText('Swap completed');
  await capture(alicePage, 'direct-completed');
  detail = await api(`/trades/${direct.id}`, alice);
  assert.equal(
    detail.events.filter((e) => e.eventType === 'completed').length,
    1,
  );
  assert.ok(detail.items.every((i) => i.currentAvailability === 'exchanged'));
  assert.deepEqual(
    await api(`/trades/${direct.id}/coffee`, alice),
    coffeeBefore,
  );

  for (const page of [alicePage, bobPage])
    await page.goto(`${origin}/swaps/${group.id}`);
  await receipt(alicePage);
  await receipt(bobPage);
  await refresh(carolPage);
  await expect(lifecycle(carolPage)).toContainText(
    '2 of 3 receipts acknowledged',
  );
  assert.equal((await api(`/trades/${group.id}`, alice)).status, 'confirmed');
  await capture(carolPage, 'group-pending');
  await receipt(carolPage);
  await expect(lifecycle(carolPage)).toContainText('Swap completed');
  await capture(carolPage, 'group-completed');
  detail = await api(`/trades/${group.id}`, alice);
  assert.equal(
    detail.events.filter((e) => e.eventType === 'completed').length,
    1,
  );
  assert.ok(detail.items.every((i) => i.currentAvailability === 'exchanged'));

  assert.deepEqual(await api(`/trades/${group.id}/coffee`, alice), groupCoffee);
  // Separate private partial handover; report retry must survive authoritative disputed refresh.
  for (const page of [alicePage, bobPage])
    await page.goto(`${origin}/swaps/${problem.id}`);
  const coffeeProblem = await api(`/trades/${problem.id}/coffee`, alice);
  const privateText =
    'Synthetic private evidence <not shared> only part of my handover arrived';
  const reportBodies = [];
  await alicePage.route(`**/trades/${problem.id}/problem`, async (route) => {
    reportBodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (reportBodies.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await lifecycle(alicePage)
    .getByRole('button', { name: 'Report a problem' })
    .click();
  await alicePage.getByLabel('Problem type').selectOption('partial_handover');
  await alicePage.getByLabel('Private report details').fill(privateText);
  await capture(alicePage, 'private-report', alicePage.getByRole('dialog'));
  await alicePage
    .getByRole('button', { name: 'Submit private report' })
    .click();
  await expect(
    alicePage.getByText(/The outcome could not be verified/),
  ).toBeVisible();
  await expect(alicePage.getByLabel('Private report details')).toHaveValue(
    privateText,
  );
  await expect(alicePage.getByLabel('Private report details')).toBeDisabled();
  await alicePage.getByRole('button', { name: 'Go back' }).click();
  await alicePage
    .getByRole('button', { name: 'Review saved submission' })
    .click();
  await alicePage
    .getByRole('button', { name: 'Retry same submission' })
    .click();
  await expect(alicePage.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(reportBodies[0], reportBodies[1]);
  await expect(lifecycle(alicePage)).toContainText(
    'Your private report was submitted. The dispute is unresolved.',
  );
  await refresh(bobPage);
  await expect(lifecycle(bobPage)).toContainText('Dispute unresolved');
  await expect(bobPage.getByText(privateText)).toHaveCount(0);
  await receipt(bobPage);
  await receipt(alicePage);
  detail = await api(`/trades/${problem.id}`, alice);
  assert.equal(detail.status, 'disputed');
  assert.equal(
    detail.events.filter((e) => e.eventType === 'disputed').length,
    1,
  );
  assert.equal(
    detail.events.filter((e) => e.eventType === 'handover_reported').length,
    1,
  );
  assert.equal(
    detail.events.filter((e) => e.eventType === 'completed').length,
    0,
  );
  assert.ok(detail.items.every((i) => i.currentAvailability === 'disputed'));
  assert.equal(
    (
      await fixture.migration.query(
        'SELECT count(*)::int AS n FROM public.item_reservations WHERE trade_id=$1 AND released_at IS NULL',
        [problem.id],
      )
    ).rows[0].n,
    detail.items.length,
  );
  assert.ok(!JSON.stringify(detail).includes(privateText));
  assert.deepEqual(
    await api(`/trades/${problem.id}/coffee`, alice),
    coffeeProblem,
  );
  await capture(alicePage, 'partial-handover-disputed');
  // Old cancellation tab discovers recorded handover; it cannot release items.
  await alicePage.goto(`${origin}/swaps/${stale.id}`);
  await alicePage
    .getByRole('button', { name: 'Cancel confirmed swap' })
    .click();
  await api(
    `/trades/${stale.id}/receipt`,
    bob,
    { operationKey: randomUUID(), expectedVersion: 1 },
    'POST',
  );
  await alicePage.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(
    alicePage.getByText(/items have not been released/),
  ).toBeVisible();
  await alicePage.getByRole('button', { name: 'Go back' }).click();
  await expect(
    alicePage.getByRole('button', { name: 'Cancel confirmed swap' }),
  ).toBeDisabled();
  assert.equal((await api(`/trades/${stale.id}`, alice)).status, 'confirmed');

  const notices = (
    await fixture.migration.query(
      "SELECT id,resource_id FROM public.notifications WHERE recipient_id=$1 AND event_type='trade_status' ORDER BY created_at DESC",
      [bob.id],
    )
  ).rows;
  for (const [id, copy] of [
    [direct.id, 'Everyone acknowledged receipt'],
    [problem.id, 'This dispute is unresolved'],
  ]) {
    const notice = notices.find((n) => n.resource_id === id);
    assert.ok(notice);
    await bobPage.goto(`${origin}/notifications/${notice.id}`);
    await expect(bobPage.getByText(new RegExp(copy))).toBeVisible();
    await expect(
      bobPage.getByRole('link', { name: 'View swap', exact: true }),
    ).toBeVisible();
    await expect(bobPage.getByText(privateText)).toHaveCount(0);
    await capture(
      bobPage,
      id === direct.id ? 'completion-notification' : 'problem-notification',
      bobPage.getByRole('region', { name: 'Notification', exact: true }),
    );
  }
  const rows = (
    await fixture.migration.query(
      'SELECT * FROM public.notifications WHERE resource_id=$1',
      [problem.id],
    )
  ).rows;
  assert.ok(!JSON.stringify(rows).includes(privateText));
  assert.deepEqual(errors, []);
  console.info(
    'Real receipt browser journey passed: direct/group completion, pending participants, private partial-handover dispute, identical-key lost-response retries, stale cancellation, independent coffee, notifications, keyboard, Light/Dark responsive axe and overflow.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
