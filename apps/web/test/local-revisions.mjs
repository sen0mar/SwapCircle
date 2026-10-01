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

const origin = 'http://127.0.0.1:4209';
const apiOrigin = 'http://127.0.0.1:4329';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4329, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const output = new URL('../test-results/revisions-local/', import.meta.url);
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
  const items = [];
  const names = ['Revision Alice', 'Revision Bob', 'Revision Carol'];
  for (const [index, user] of [alice, bob, stranger].entries()) {
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
          title: `Revision item ${index + 1}`,
          description: 'Synthetic revision item',
          condition: 'good',
        },
        'POST',
      ),
    );
  }
  const extra = await api(
    '/listings',
    bob,
    {
      title: 'Reusable draft bag',
      description: 'Synthetic extra item',
      condition: 'good',
    },
    'POST',
  );
  const proposal = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: [alice.id, bob.id],
      transfers: [
        { listingId: items[0].id, ownerId: alice.id, recipientId: bob.id },
        { listingId: items[1].id, ownerId: bob.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
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
      '4209',
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
  const alicePage = await (await browser.newContext()).newPage();
  const bobPage = await (await browser.newContext()).newPage();
  const carolPage = await (await browser.newContext()).newPage();
  const errors = [];
  for (const page of [alicePage, bobPage, carolPage])
    page.on('pageerror', (error) => errors.push(error.message));
  await signIn(alicePage, alice, `/swaps/${proposal.id}`);
  await signIn(bobPage, bob, `/swaps/${proposal.id}`);
  await bobPage
    .getByRole('button', { name: 'Edit proposal', exact: true })
    .click();
  await bobPage.getByRole('checkbox', { name: extra.title }).check();
  await bobPage
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  await expect(
    bobPage.getByRole('button', { name: 'Save revision' }),
  ).toBeVisible();
  await alicePage
    .getByRole('button', { name: 'Edit proposal', exact: true })
    .click();
  await alicePage.getByLabel('Add a person').selectOption(stranger.id);
  await alicePage.getByRole('checkbox', { name: items[2].title }).check();
  await alicePage
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  await alicePage.getByRole('button', { name: 'Save revision' }).click();
  await expect(
    alicePage.getByText('Proposed · Version 2', { exact: true }),
  ).toBeVisible();
  await expect(
    alicePage.getByRole('region', { name: 'Term changes' }),
  ).toContainText('participant added');
  const before = await api(`/trades/${proposal.id}`, alice);
  assert.equal(before.participants.length, 3);
  await signIn(carolPage, stranger, `/swaps/${proposal.id}`);
  await expect(
    carolPage.getByText('Renewed agreement required', { exact: false }).first(),
  ).toBeVisible();
  await bobPage.getByRole('button', { name: 'Save revision' }).click();
  const conflict = bobPage.getByRole('region', { name: 'Proposal conflict' });
  await expect(conflict).toContainText('latest version 2');
  await expect(conflict).toContainText('Revision Carol');
  await expect(
    bobPage.getByRole('button', { name: 'Save revision' }),
  ).toBeDisabled();
  assert.equal((await api(`/trades/${proposal.id}`, alice)).currentVersion, 2);
  // Responsive conflict views retain the exact draft and expose latest saved terms.
  for (const theme of ['light', 'dark']) {
    // Background is inert: change theme through the actual shell before reopening the dialog.
    await bobPage.getByRole('button', { name: 'Close', exact: true }).click();
    await bobPage.getByLabel('Theme').selectOption(theme);
    await bobPage
      .getByRole('button', { name: 'Edit proposal', exact: true })
      .click();
    for (const width of [360, 768, 800, 1280, 1600]) {
      await bobPage.setViewportSize({ width, height: 900 });
      await expect(conflict).toContainText('latest version 2');
      assert.ok(
        await bobPage.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: bobPage }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280) {
        await bobPage.screenshot({
          path: new URL(`conflict-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
        await conflict
          .getByRole('button', {
            name: 'Reuse draft and review latest version',
          })
          .scrollIntoViewIfNeeded();
        await bobPage.screenshot({
          path: new URL(`conflict-controls-${theme}-${width}.png`, output)
            .pathname,
          fullPage: true,
        });
        await bobPage
          .getByRole('heading', { name: 'Edit proposal draft' })
          .scrollIntoViewIfNeeded();
      }
    }
  }
  for (let index = 0; index < 20; index++) {
    await bobPage.keyboard.press('Tab');
    assert.ok(
      await bobPage
        .getByRole('dialog')
        .evaluate((dialog) =>
          dialog.contains(globalThis.document.activeElement),
        ),
    );
  }
  await bobPage.keyboard.press('Escape');
  await expect(
    bobPage.getByRole('button', { name: 'Edit proposal', exact: true }),
  ).toBeFocused();
  await expect(
    bobPage.getByText('Proposed · Version 2', { exact: true }),
  ).toBeVisible();
  await bobPage.keyboard.press('Enter');
  await conflict
    .getByRole('button', { name: 'Reuse draft and review latest version' })
    .focus();
  await bobPage.keyboard.press('Enter');
  await expect(
    bobPage.getByRole('checkbox', { name: extra.title }),
  ).toBeChecked();
  assert.equal((await api(`/trades/${proposal.id}`, alice)).currentVersion, 2);
  // Reuse is deliberate; review the complete replacement, then remove the added draft item.
  await bobPage
    .getByRole('button', { name: `Remove item ${extra.title}`, exact: true })
    .click();
  await bobPage
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  await expect(bobPage.getByText(/Draft participants:/)).not.toContainText(
    'Revision Carol',
  );
  await bobPage.getByRole('button', { name: 'Save revision' }).click();
  await expect(
    bobPage.getByText('Proposed · Version 3', { exact: true }),
  ).toBeVisible();
  await expect(
    bobPage.getByRole('region', { name: 'Term changes' }),
  ).toContainText('participant removed');
  await carolPage.reload();
  await expect(
    carolPage.getByText('This swap cannot be found or you do not have access.'),
  ).toBeVisible();
  // Material listing edit goes through the real owner form and advances the proposal version.
  await alicePage.goto(`${origin}/listings/${items[0].id}/edit`);
  await alicePage
    .getByLabel('Description')
    .fill('Revised lamp details: small scratch on base');
  await alicePage.getByRole('radio', { name: 'Fair', exact: true }).check();
  await alicePage.getByRole('button', { name: 'Save item' }).click();
  await expect(alicePage).toHaveURL(`${origin}/listings/${items[0].id}`);
  await bobPage.reload();
  await expect(
    bobPage.getByText('Proposed · Version 4', { exact: true }),
  ).toBeVisible();
  await expect(
    bobPage.getByRole('region', { name: 'Term changes' }),
  ).toContainText('listing snapshot revised');
  await expect(bobPage.getByText(/Revised lamp details/)).toBeVisible();
  const old = await api(`/trades/${proposal.id}/versions/1`, alice);
  assert.equal(
    old.items.find((item) => item.listingId === items[0].id)
      .descriptionSnapshot,
    'Synthetic revision item',
  );
  assert.ok(
    (await api(`/trades/${proposal.id}`, bob)).participants.every(
      (person) => person.acceptedVersion === null,
    ),
  );
  for (const theme of ['light', 'dark']) {
    await bobPage.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 1280]) {
      await bobPage.setViewportSize({ width, height: 900 });
      await bobPage.screenshot({
        path: new URL(`revised-${theme}-${width}.png`, output).pathname,
        fullPage: true,
      });
    }
  }
  // Synthetic confirmed fixture tests the existing frozen contract; no acceptance endpoint is introduced.
  await fixture.migration.query(
    "UPDATE public.trades SET status='confirmed' WHERE id=$1",
    [proposal.id],
  );
  await bobPage.reload();
  await expect(
    bobPage.getByText(/Confirmed terms are read-only/),
  ).toBeVisible();
  await expect(
    bobPage.getByRole('button', { name: 'Edit proposal', exact: true }),
  ).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await bobPage.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await bobPage.setViewportSize({ width, height: 900 });
      assert.ok(
        await bobPage.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: bobPage }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await bobPage.screenshot({
          path: new URL(`confirmed-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  const unavailable = await api(
    '/trades',
    alice,
    {
      operationKey: randomUUID(),
      participantIds: [alice.id, bob.id],
      transfers: [
        { listingId: items[0].id, ownerId: alice.id, recipientId: bob.id },
        { listingId: extra.id, ownerId: bob.id, recipientId: alice.id },
      ],
      meetingMode: 'meet_to_swap',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    'POST',
  );
  await api(
    `/listings/${extra.id}/withdraw`,
    bob,
    { revision: extra.revision },
    'POST',
  );
  await bobPage.goto(`${origin}/swaps/${unavailable.id}`);
  await expect(
    bobPage.getByText(/proposed item is no longer available/),
  ).toBeVisible();
  await bobPage
    .getByRole('button', { name: 'Edit proposal', exact: true })
    .click();
  await bobPage
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  await expect(bobPage.getByRole('alert')).toContainText(
    'Remove it and choose another item',
  );
  await expect(
    bobPage.getByRole('button', { name: `Remove item ${extra.title}` }),
  ).toBeVisible();
  await bobPage.keyboard.press('Escape');
  for (const theme of ['light', 'dark']) {
    await bobPage.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await bobPage.setViewportSize({ width, height: 900 });
      assert.ok(
        await bobPage.evaluate(
          () =>
            globalThis.document.documentElement.scrollWidth <=
            globalThis.innerWidth,
        ),
      );
      assert.deepEqual(
        (await new AxeBuilder({ page: bobPage }).analyze()).violations,
        [],
      );
      if (width === 360 || width === 1280)
        await bobPage.screenshot({
          path: new URL(`unavailable-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
  }
  assert.deepEqual(errors, []);
  console.info(
    'Real revision UI, participant add/remove, stale two-session recovery, draft retention, listing edits, immutable snapshots, frozen terms, keyboard, themes and accessibility passed.',
  );
} finally {
  if (browser) await browser.close();
  if (preview) process.kill(-preview.pid, 'SIGTERM');
  server.close();
  await fixture.cleanup();
}
