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

  for (const user of [alice, bob])
    await api(
      `/trades/${direct.id}/accept`,
      user,
      { operationKey: randomUUID(), expectedVersion: 1 },
      'POST',
    );

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
  await signIn(alicePage, alice, `/swaps/${direct.id}`);
  await signIn(bobPage, bob, `/swaps/${direct.id}`);
  const meeting = (page) =>
    page.getByRole('region', { name: 'Meetup reminder', exact: true });
  await expect(meeting(alicePage)).toContainText('No meetup details saved yet');
  await expect(
    alicePage.getByRole('button', {
      name: /Plan meetup|Confirm this meeting|Decline this meeting/,
    }),
  ).toHaveCount(0);
  let saved = await api(
    `/trades/${direct.id}/meeting`,
    alice,
    {
      operationKey: randomUUID(),
      expectedTradeVersion: 1,
      place: 'Synthetic public library entrance',
      meetingAt: '2026-10-25T01:30:00.000Z',
      timeZone: 'Europe/Paris',
    },
    'POST',
  );
  await alicePage.reload();
  await bobPage.reload();
  for (const page of [alicePage, bobPage]) {
    await expect(meeting(page)).toContainText(
      'Synthetic public library entrance',
    );
    await expect(meeting(page)).toContainText('Europe/Paris');
    await expect(meeting(page).locator('time')).toHaveAttribute(
      'datetime',
      saved.meetingAt,
    );
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }
  // Saved server-side responses do not add confirmation controls to reminders.
  await api(
    `/trades/${direct.id}/meeting/respond`,
    bob,
    {
      operationKey: randomUUID(),
      expectedTradeVersion: 1,
      expectedRevision: saved.revision,
      expectedResponse: null,
      response: 'confirmed',
    },
    'POST',
  );
  saved = await api(
    `/trades/${direct.id}/meeting`,
    alice,
    {
      operationKey: randomUUID(),
      expectedTradeVersion: 1,
      expectedRevision: saved.revision,
      place: 'Synthetic public museum entrance',
      meetingAt: saved.meetingAt,
      timeZone: saved.timeZone,
    },
    'PUT',
  );
  assert.ok(saved.responses.every((person) => person.response === null));
  await alicePage.reload();
  await bobPage.reload();
  await expect(meeting(alicePage)).toContainText(
    'Synthetic public museum entrance',
  );
  await expect(meeting(bobPage)).toContainText(
    'Synthetic public museum entrance',
  );
  await expect(
    alicePage.getByRole('button', { name: /Change meetup|Review meetup/ }),
  ).toHaveCount(0);
  // A failed reminder read can be retried without exposing an editing form.
  await alicePage.route(`**/trades/${direct.id}/meeting`, (route) =>
    route.abort('failed'),
  );
  await alicePage.reload();
  await expect(meeting(alicePage).getByRole('alert')).toContainText(
    'could not be refreshed',
  );
  await alicePage.unroute(`**/trades/${direct.id}/meeting`);
  await meeting(alicePage)
    .getByRole('button', { name: 'Retry meetup details' })
    .click();
  await expect(meeting(alicePage)).toContainText(
    'Synthetic public museum entrance',
  );
  const denial = await fetch(`${apiOrigin}/api/v1/meetups/${saved.id}`, {
    headers: { Authorization: `Bearer ${stranger.token}` },
  });
  assert.equal(denial.status, 404);
  for (const theme of ['light', 'dark']) {
    await alicePage.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 1280, 1600]) {
      await alicePage.setViewportSize({ width, height: 900 });
      assert.ok(
        await alicePage.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: alicePage }).analyze()).violations,
        [],
      );
    }
    await expect(alicePage.getByRole('dialog')).toHaveCount(0);
    await expect(alicePage.getByRole('textbox')).toHaveCount(0);
  }
  assert.deepEqual(errors, []);
  console.info(
    'Local read-only meetup reminders, explicit time zones, server revision refresh, read retry, privacy, responsive layouts and accessibility passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
