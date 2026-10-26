// Real local Express/PostgreSQL and production browser with synthetic accounts.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;

const origin = 'http://127.0.0.1:4207';
const apiOrigin = 'http://127.0.0.1:4327';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4327, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/swaps-local/', import.meta.url);
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
  for (const [user, displayName] of [
    [alice, 'Swap Alice'],
    [bob, 'Swap Bob'],
    [stranger, 'Swap Carol'],
  ])
    await api(
      '/profiles/me',
      user,
      {
        displayName,
        biography: '',
        approximateLocation: 'Paris area',
        interestIds: [],
      },
      'PUT',
    );
  const aliceItem = await api(
    '/listings',
    alice,
    {
      title: `Everyday backpack ${randomUUID().slice(0, 6)}`,
      description: 'Synthetic local backpack',
      condition: 'good',
    },
    'POST',
  );
  const bobItem = await api(
    '/listings',
    bob,
    {
      title: `Film camera ${randomUUID().slice(0, 6)}`,
      description: 'Synthetic local camera',
      condition: 'good',
    },
    'POST',
  );

  for (const [user, listing, file] of [
    [alice, aliceItem, 'backpack.jpg'],
    [bob, bobItem, 'camera.jpg'],
  ]) {
    const response = await fetch(
      `${apiOrigin}/api/v1/listings/${listing.id}/photos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'image/jpeg',
        },
        body: await readFile(new URL(`../src/assets/${file}`, import.meta.url)),
      },
    );
    assert.equal(response.status, 201);
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
      '4207',
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
  const alicePage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const bobPage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const outsiderPage = await (
    await browser.newContext({ reducedMotion: 'reduce' })
  ).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, outsiderPage])
    page.on('pageerror', (error) => errors.push(error.message));

  await signIn(alicePage, alice, `/listings/${bobItem.id}`);
  await expect(
    alicePage.getByRole('button', { name: 'Propose a trade' }),
  ).toBeVisible();
  await alicePage.getByRole('button', { name: 'Propose a trade' }).click();
  await alicePage.getByRole('radio', { name: 'Choose from my shelf' }).check();
  await alicePage
    .getByRole('radio', { name: new RegExp(aliceItem.title) })
    .check();
  await alicePage
    .getByLabel('Message', { exact: true })
    .fill('Would you trade for my backpack?');
  await alicePage.getByRole('button', { name: 'Send proposal' }).click();
  await expect(alicePage).toHaveURL(/\/inbox\/[0-9a-f-]+$/);
  const conversation = new URL(alicePage.url()).pathname.split('/').at(-1);
  const messages = await fixture.migration.query(
    `SELECT m.id,m.proposal,r.decision FROM public.messages m LEFT JOIN public.message_proposal_responses r ON r.message_id=m.id WHERE m.conversation_id=$1 AND m.proposal IS NOT NULL`,
    [conversation],
  );
  assert.equal(messages.rows.length, 1);
  assert.equal(messages.rows[0].decision, null);
  assert.equal(
    messages.rows[0].proposal.message,
    'Would you trade for my backpack?',
  );
  assert.deepEqual(messages.rows[0].proposal.offeredListing, {
    id: aliceItem.id,
    title: aliceItem.title,
  });

  // Exercise the existing formal-trade reminder lifecycle using an API-created fixture.
  const formal = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: [alice.id, bob.id],
      transfers: [
        { listingId: aliceItem.id, ownerId: alice.id, recipientId: bob.id },
        { listingId: bobItem.id, ownerId: bob.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    'POST',
  );
  const tradeId = formal.id;
  await alicePage.goto(`${origin}/swaps/${tradeId}`);
  await signIn(bobPage, bob, '/swaps');
  await expect(
    alicePage.getByRole('heading', { name: 'You give', exact: true }),
  ).toBeVisible();
  await expect(
    alicePage
      .getByLabel('Swap status', { exact: true })
      .filter({ hasText: 'Proposed' }),
  ).toBeVisible();
  await alicePage.reload();
  await expect(alicePage.getByText(aliceItem.title).first()).toBeVisible();
  await alicePage.getByRole('link', { name: 'My Swaps' }).first().click();
  await expect(
    alicePage.getByRole('heading', { name: 'No upcoming swaps' }),
  ).toBeVisible();
  await expect(alicePage.getByRole('link', { name: /^View swap/ })).toHaveCount(
    0,
  );
  await alicePage.getByLabel('Theme').selectOption('light');
  await alicePage.setViewportSize({ width: 360, height: 900 });
  await alicePage.screenshot({
    path: new URL('alice-swaps-light-360.png', output).pathname,
    fullPage: true,
  });

  await bobPage.goto(`${origin}/swaps`);
  await expect(
    bobPage.getByRole('heading', { name: 'No upcoming swaps' }),
  ).toBeVisible();
  await bobPage.reload();
  await expect(
    bobPage.getByRole('heading', { name: 'No upcoming swaps' }),
  ).toBeVisible();
  await bobPage.getByLabel('Theme').selectOption('dark');
  await bobPage.setViewportSize({ width: 1280, height: 900 });
  await bobPage.screenshot({
    path: new URL('bob-swaps-dark-1280.png', output).pathname,
    fullPage: true,
  });
  await bobPage.getByRole('button', { name: /Open notifications/ }).click();
  await expect(
    bobPage
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await bobPage
    .getByRole('dialog', { name: 'Notifications' })
    .getByRole('link', { name: /^View swap/ })
    .click();
  await expect(bobPage).toHaveURL(`${origin}/swaps/${tradeId}`);
  await expect(
    bobPage.getByRole('button', { name: 'Review current terms', exact: true }),
  ).toBeVisible();
  await expect(bobPage.getByText(bobItem.title).first()).toBeVisible();

  const state = await fixture.migration.query(
    'SELECT invitation_status,accepted_version FROM public.trade_participants WHERE trade_id=$1 AND user_id=$2',
    [tradeId, bob.id],
  );
  assert.equal(state.rows[0].invitation_status, 'invited');
  assert.equal(state.rows[0].accepted_version, null);
  const listings = await fixture.migration.query(
    'SELECT availability FROM public.listings WHERE id=ANY($1::uuid[])',
    [[aliceItem.id, bobItem.id]],
  );
  assert.ok(listings.rows.every((row) => row.availability === 'available'));

  await signIn(outsiderPage, stranger, `/swaps/${tradeId}`);
  await expect(
    outsiderPage.getByText(
      'This swap cannot be found or you do not have access.',
    ),
  ).toBeVisible();
  assert.equal((await api('/trades/mine', stranger)).items.length, 0);

  // Both people must accept the exact terms before either item is reserved.
  await alicePage.goto(`${origin}/swaps/${tradeId}`);
  await alicePage.getByRole('button', { name: 'Review current terms' }).click();
  await alicePage.getByRole('button', { name: 'Accept version 1' }).click();
  await expect(
    alicePage.getByText(
      'Your acceptance is saved. Waiting for the other person.',
    ),
  ).toBeVisible();
  const pendingListings = await api(`/listings/${aliceItem.id}`, alice);
  assert.equal(pendingListings.availability, 'available');
  await bobPage.reload();
  await bobPage.getByRole('button', { name: 'Review current terms' }).click();
  await bobPage.getByRole('button', { name: 'Accept version 1' }).click();
  await expect(bobPage.getByRole('status', { name: 'Swap status' })).toHaveText(
    'Confirmed',
  );
  await alicePage.reload();
  await expect(
    alicePage.getByRole('status', { name: 'Swap status' }),
  ).toHaveText('Confirmed');
  const confirmed = await api(`/trades/${tradeId}`, alice);
  assert.equal(confirmed.participantCount, 2);
  assert.ok(
    confirmed.participants.every((person) => person.acceptedVersion === 1),
  );
  assert.ok(
    confirmed.items.every((item) => item.currentAvailability === 'reserved'),
  );

  const meeting = await api(
    `/trades/${tradeId}/meeting`,
    alice,
    {
      operationKey: randomUUID(),
      expectedTradeVersion: 1,
      place: 'Synthetic test meeting point',
      meetingAt: new Date(Date.now() + 86400000).toISOString(),
      timeZone: 'Europe/Paris',
    },
    'POST',
  );
  await alicePage.goto(`${origin}/swaps`);
  await expect(
    alicePage.getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await expect(
    alicePage.getByRole('button', { name: 'Confirm swap completed' }),
  ).toHaveCount(0);

  // Advance this isolated fixture's meeting, without waiting for real time.
  await fixture.migration.query(
    "UPDATE public.meetups SET meeting_at=now()-interval '1 hour' WHERE id=$1 AND trade_id=$2",
    [meeting.id, tradeId],
  );

  for (const [name, page] of [
    ['alice', alicePage],
    ['bob', bobPage],
  ]) {
    await page.goto(`${origin}/swaps`);
    await expect(
      page.getByRole('button', { name: 'Confirm swap completed' }),
    ).toBeVisible();
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      for (const width of [360, 768, 1280, 1600]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(
          await page.evaluate(
            () =>
              globalThis.document.documentElement.scrollWidth <=
              globalThis.innerWidth,
          ),
        );
        const navBounds = await page
          .getByRole('tablist', { name: 'Swap views' })
          .boundingBox();
        const headingBounds = await page
          .getByRole('tabpanel', { name: 'Upcoming swaps' })
          .boundingBox();
        assert.ok(
          navBounds.y < headingBounds.y,
          'Section navigation stays above the content at every width',
        );
        await expect(
          page.getByRole('img', { name: `${aliceItem.title}, photo 1` }),
        ).toBeVisible();
        await expect(
          page.getByRole('img', { name: `${bobItem.title}, photo 1` }),
        ).toBeVisible();
        await page.getByRole('tab', { name: 'Upcoming swaps' }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(
          page.getByRole('tab', { name: 'Swap history' }),
        ).toBeFocused();
        await expect(
          page.getByRole('tabpanel', { name: 'Swap history' }),
        ).toBeVisible();
        await expect(
          page.getByRole('tabpanel', { name: 'Upcoming swaps' }),
        ).toHaveCount(0);
        assert.deepEqual(
          (await new AxeBuilder({ page }).analyze()).violations,
          [],
        );
        await page.keyboard.press('ArrowLeft');
        await expect(
          page.getByRole('tab', { name: 'Upcoming swaps' }),
        ).toBeFocused();
        assert.deepEqual(
          (await new AxeBuilder({ page }).analyze()).violations,
          [],
        );
        if (width === 360 || width === 1280)
          await page.screenshot({
            path: new URL(`${name}-${theme}-${width}.png`, output).pathname,
            fullPage: true,
          });
      }
    }
  }
  await alicePage.setViewportSize({ width: 1280, height: 900 });
  await alicePage.evaluate(() => {
    globalThis.document.documentElement.style.zoom = '2';
  });
  assert.ok(
    await alicePage.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  );
  await expect(
    alicePage.getByRole('button', { name: 'Confirm swap completed' }),
  ).toBeVisible();
  await alicePage.evaluate(() => {
    globalThis.document.documentElement.style.zoom = '';
  });
  await alicePage.getByRole('link', { name: /^View swap/ }).focus();
  await alicePage.keyboard.press('Enter');
  await expect(alicePage).toHaveURL(`${origin}/swaps/${tradeId}`);
  const reminder = alicePage.getByRole('region', { name: 'Meetup reminder' });
  await expect(
    reminder.getByText('Synthetic test meeting point'),
  ).toBeVisible();
  await expect(reminder.getByText(/Europe\/Paris/)).toBeVisible();
  await expect(alicePage.getByRole('textbox')).toHaveCount(0);
  await expect(
    alicePage.getByRole('button', {
      name: /Change meetup|Review meetup|Confirm this meeting|Decline this meeting|Cancel swap|Review current terms/,
    }),
  ).toHaveCount(0);
  await expect(
    alicePage.getByRole('button', { name: 'Message', exact: true }),
  ).toBeVisible();
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
      const meetupBounds = await reminder.boundingBox();
      const itemBounds = await alicePage
        .getByRole('region', { name: 'Items in this swap' })
        .boundingBox();
      assert.ok(
        meetupBounds.y < itemBounds.y,
        'Meetup details come before the item summary',
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: alicePage }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await alicePage.screenshot({
          path: new URL(`readonly-reminder-${theme}-${width}.png`, output)
            .pathname,
          fullPage: true,
        });
    }
  }
  await alicePage.evaluate(() => {
    globalThis.document.documentElement.style.zoom = '2';
  });
  assert.ok(
    await alicePage.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  );
  await alicePage.evaluate(() => {
    globalThis.document.documentElement.style.zoom = '';
  });

  await alicePage.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(alicePage).toHaveURL(/\/inbox\/[0-9a-f-]+$/);
  await alicePage.goto(`${origin}/swaps`);
  await alicePage
    .getByRole('button', { name: 'Confirm swap completed' })
    .click();
  await expect(
    alicePage
      .getByRole('tabpanel', { name: 'Upcoming swaps' })
      .getByRole('link'),
  ).toHaveCount(0);
  await alicePage.getByRole('tab', { name: 'Swap history' }).click();
  await expect(
    alicePage
      .getByRole('tabpanel', { name: 'Swap history' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await expect(
    alicePage.getByRole('tabpanel', { name: 'Upcoming swaps' }),
  ).toHaveCount(0);
  assert.equal((await api(`/trades/${tradeId}`, alice)).status, 'confirmed');
  await alicePage.reload();
  await expect(
    alicePage
      .getByRole('tabpanel', { name: 'Swap history' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await bobPage.reload();
  await expect(
    bobPage.getByRole('tabpanel', { name: 'Swap history' }),
  ).toHaveCount(0);
  await expect(
    bobPage
      .getByRole('tabpanel', { name: 'Upcoming swaps' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await bobPage.getByRole('button', { name: 'Confirm swap completed' }).click();
  await bobPage.getByRole('tab', { name: 'Swap history' }).click();
  await expect(
    bobPage
      .getByRole('tabpanel', { name: 'Swap history' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await alicePage.reload();
  await expect(
    alicePage
      .getByRole('tabpanel', { name: 'Swap history' })
      .getByRole('link', { name: /^View swap/ }),
  ).toBeVisible();
  await expect(
    alicePage.getByRole('tabpanel', { name: 'Upcoming swaps' }),
  ).toHaveCount(0);
  assert.equal((await api(`/trades/${tradeId}`, alice)).status, 'completed');
  await alicePage
    .getByRole('tabpanel', { name: 'Swap history' })
    .getByRole('link', { name: /^View swap/ })
    .click();
  await expect(
    alicePage
      .getByRole('region', { name: 'Meetup reminder' })
      .getByText('Synthetic test meeting point'),
  ).toBeVisible();
  await expect(alicePage.getByRole('textbox')).toHaveCount(0);
  await expect(
    alicePage.getByRole('button', {
      name: /Change meetup|Confirm this meeting|Decline this meeting/,
    }),
  ).toHaveCount(0);

  assert.deepEqual(errors, []);
  console.info(
    'Local swap submission, notification, both lists, private access, two-person confirmation, reservations, scheduled reminders, independent personal completion, persistent history, themes and accessibility passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
