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
const output = new URL('../test-results/meetings-local/', import.meta.url);
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
        displayName: ['Meeting Alice', 'Meeting Bob', 'Meeting Carol'][index],
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: interests.slice(0, 2).map((i) => i.id),
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
  await signIn(alicePage, alice, `/swaps/${direct.id}`);
  await signIn(bobPage, bob, `/swaps/${direct.id}`);
  const meeting = (page) =>
    page.getByRole('region', { name: 'Meeting arrangement', exact: true });
  const a = meeting(alicePage),
    b = meeting(bobPage);
  await api(
    `/trades/${direct.id}/accept`,
    alice,
    { operationKey: randomUUID(), expectedVersion: 1 },
    'POST',
  );
  const coffeeInvite = await api(
    `/trades/${direct.id}/coffee`,
    alice,
    { operationKey: randomUUID(), inviteeId: bob.id, offerToPay: true },
    'POST',
  );
  await api(
    `/trades/${direct.id}/coffee/${coffeeInvite.id}/respond`,
    bob,
    { action: 'accept' },
    'POST',
  );
  const baseline = await api(`/trades/${direct.id}`, alice);
  const coffeeBaseline = await api(`/trades/${direct.id}/coffee`, alice);
  const refresh = async (page) => {
    await meeting(page)
      .getByRole('button', { name: 'Refresh meeting', exact: true })
      .click();
    await expect(
      meeting(page).getByRole('button', {
        name: 'Change meeting',
        exact: true,
      }),
    ).toBeEnabled();
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
          await meeting(page).screenshot({
            path: new URL(`${state}-${theme}-${width}-meeting.png`, output)
              .pathname,
          });
        }
      }
    }
  };
  await a.getByRole('button', { name: 'Plan meeting', exact: true }).click();
  await a
    .getByLabel('Public meeting place')
    .fill('Synthetic public library entrance');
  await a.getByLabel('Arrangement time zone').fill('Europe/Paris');
  await a
    .getByLabel('Date and time in arrangement zone')
    .fill('2026-03-29T02:30');
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(a).toContainText('Choose a valid local date');
  await a
    .getByLabel('Date and time in arrangement zone')
    .fill('2026-10-25T02:30:00.123');
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(a.getByLabel(/First occurrence/)).not.toBeChecked();
  await expect(a.getByLabel(/Second occurrence/)).not.toBeChecked();
  await a.getByLabel(/Second occurrence/).check();
  await capture(alicePage, 'repeated-time');
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(
    a.getByRole('heading', { name: 'Arrangement 1', exact: true }),
  ).toBeVisible();
  let saved = await api(`/trades/${direct.id}/meeting`, alice);
  assert.equal(saved.meetingAt, '2026-10-25T01:30:00.123Z');
  await refresh(bobPage);
  await expect(b).toContainText('America/New_York');
  assert.equal(
    await a.locator('time').getAttribute('datetime'),
    await b.locator('time').getAttribute('datetime'),
  );
  await b.getByRole('button', { name: 'Confirm this meeting' }).click();
  await expect(b).toContainText('Meeting Bob (you) · Meeting confirmed');
  await capture(bobPage, 'confirmed');
  await refresh(alicePage);
  await a.getByRole('button', { name: 'Change meeting' }).click();
  await expect(a.getByLabel('Date and time in arrangement zone')).toHaveValue(
    '2026-10-25T02:30:00.123',
  );
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(a.getByRole('button', { name: 'Change meeting' })).toBeEnabled();
  const unchanged = await api(`/trades/${direct.id}/meeting`, alice);
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.meetingAt, '2026-10-25T01:30:00.123Z');
  assert.equal(
    unchanged.responses.find((p) => p.userId === bob.id).response,
    'confirmed',
  );
  await a.getByRole('button', { name: 'Change meeting' }).click();
  await a
    .getByLabel('Public meeting place')
    .fill('Synthetic public museum entrance');
  await a
    .getByLabel('Date and time in arrangement zone')
    .fill('2026-10-26T15:00');
  // Concurrent revision leaves the independent draft intact and requires deliberate reuse.
  saved = await api(
    `/trades/${direct.id}/meeting`,
    bob,
    {
      place: 'Synthetic public square',
      mapLink: null,
      meetingAt: '2026-10-26T11:00:00.000Z',
      timeZone: 'Europe/Paris',
      operationKey: randomUUID(),
      expectedTradeVersion: 1,
      expectedRevision: saved.revision,
    },
    'PUT',
  );
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(a).toContainText('The arrangement or trade changed');
  await expect(a.getByLabel('Public meeting place')).toHaveValue(
    'Synthetic public museum entrance',
  );
  await capture(alicePage, 'stale-draft');
  await a
    .getByRole('button', { name: 'Reuse draft for current arrangement' })
    .click();
  let intercepted = [],
    lose = true;
  await alicePage.route(`**/trades/${direct.id}/meeting`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    intercepted.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (lose) {
      lose = false;
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await a.getByRole('button', { name: 'Save meeting' }).click();
  await expect(a).toContainText('outcome could not be verified');
  await expect(a.getByLabel('Public meeting place')).toHaveValue(
    'Synthetic public museum entrance',
  );
  await capture(alicePage, 'lost-response');
  await a.getByRole('button', { name: 'Retry meeting action' }).click();
  await expect(
    a.getByRole('heading', { name: 'Arrangement 3', exact: true }),
  ).toBeVisible();
  assert.deepEqual(intercepted[0], intercepted[1]);
  await alicePage.unroute(`**/trades/${direct.id}/meeting`);
  await refresh(bobPage);
  await expect(b).toContainText('Changed arrangement');
  await expect(b).toContainText('Meeting Bob (you) · Meeting response pending');
  await expect(b).toContainText('Synthetic public museum entrance');
  await capture(bobPage, 'revised');
  await b.getByRole('button', { name: 'Decline this meeting' }).click();
  await expect(b).toContainText('Meeting Bob (you) · Meeting declined');
  await b.getByRole('button', { name: 'Confirm this meeting' }).click();
  await expect(b).toContainText('Meeting Bob (you) · Meeting confirmed');
  await capture(bobPage, 'reconfirmed');
  await refresh(alicePage);
  await a.getByRole('button', { name: 'Confirm this meeting' }).click();
  await expect(a).toContainText('Everyone confirmed this arrangement.');
  await refresh(bobPage);
  await expect(b).toContainText('Everyone confirmed this arrangement.');
  await capture(bobPage, 'everyone-confirmed');
  for (const page of [alicePage, bobPage]) {
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      const button = meeting(page).getByRole('button', {
        name: 'Change meeting',
      });
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(
        meeting(page).getByLabel('Public meeting place'),
      ).toBeVisible();
      await meeting(page).getByLabel('Public meeting place').focus();
      await page.keyboard.press('Tab');
      await expect(
        meeting(page).getByLabel('HTTPS map link (optional)'),
      ).toBeFocused();
      await meeting(page)
        .getByRole('button', { name: 'Discard meeting draft' })
        .click();
      await expect(
        meeting(page).getByRole('heading', {
          name: 'Meeting arrangement',
          exact: true,
        }),
      ).toBeFocused();
    }
  }
  assert.deepEqual(await api(`/trades/${direct.id}`, alice), baseline);
  assert.deepEqual(
    await api(`/trades/${direct.id}/coffee`, alice),
    coffeeBaseline,
  );
  const notifications = await (
    await fetch(
      `${fixture.publicAuth.url}/rest/v1/notifications?select=id,event_type,resource_type,resource_id&recipient_id=eq.${bob.id}`,
      {
        headers: {
          apikey: fixture.publicAuth.key,
          Authorization: `Bearer ${bob.token}`,
        },
      },
    )
  ).json();
  const notice = notifications.find((n) => n.resource_type === 'meetup');
  assert.ok(notice);
  assert.ok(!JSON.stringify(notifications).includes('Synthetic public'));
  await bobPage.goto(`${origin}/notifications/${notice.id}`);
  await bobPage.getByRole('link', { name: 'View meeting in swap' }).click();
  await expect(bobPage).toHaveURL(`${origin}/swaps/${direct.id}#meeting`);
  await signIn(outsider, stranger, `/notifications/${notice.id}`);
  await expect(
    outsider.getByText('Synthetic public museum entrance'),
  ).toHaveCount(0);
  const denial = await fetch(`${apiOrigin}/api/v1/meetups/${saved.id}`, {
    headers: { Authorization: `Bearer ${stranger.token}` },
  });
  assert.equal(denial.status, 404);
  await alicePage.route(`**/trades/${direct.id}/meeting`, (route) =>
    route.abort('failed'),
  );
  await a.getByRole('button', { name: 'Refresh meeting' }).click();
  await expect(a).toContainText('could not be refreshed');
  await expect(
    a.getByRole('button', { name: 'Confirm this meeting' }),
  ).toBeDisabled();
  await capture(alicePage, 'read-failure');
  assert.deepEqual(errors, []);
  console.info(
    'Real local meeting journey: cross-zone scheduling, DST choice/gap, confirmation, revision invalidation, stale drafts, lost-response same-key recovery, consent independence, private notifications, outsider denial, keyboard, responsive Light/Dark and axe passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
