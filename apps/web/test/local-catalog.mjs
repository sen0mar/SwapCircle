// Real local Express/PostgreSQL/Storage browser journey. Only the external OAuth handoff is simulated.
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';

const fetch = globalThis.fetch;
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const origin = 'http://127.0.0.1:4196';
const apiOrigin = 'http://127.0.0.1:4316';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4316, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, carol, dan] = fixture.users;
let preview;
let browser;
const marker = `local${randomUUID().replaceAll('-', '')}`;
const fixtureInterestIds = [randomUUID(), randomUUID()];
const title = `Camera ${marker}`;
const output = new URL('../test-results/catalog-local/', import.meta.url);
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
  return response.json();
};
try {
  // Dedicated local fixture interests keep the four-member preview deterministic
  // when the development database already contains a demo community.
  for (const [index, id] of fixtureInterestIds.entries())
    await fixture.migration.query(
      'INSERT INTO public.interests (id, name) VALUES ($1, $2)',
      [id, `Verification ${marker} ${index}`],
    );
  const interests = (await api('/interests')).filter((interest) =>
    fixtureInterestIds.includes(interest.id),
  );
  for (const [user, name, selected] of [
    [alice, 'Local Alice', interests],
    [bob, 'Local Bob', interests],
    [carol, 'Local Carol', interests.slice(0, 1)],
    [dan, 'Local Dan', []],
  ]) {
    await api(
      '/profiles/me',
      user,
      {
        displayName: name,
        biography: 'Synthetic local verification only.',
        approximateLocation: 'Paris area',
        interestIds: selected.map((interest) => interest.id),
      },
      'PUT',
    );
  }
  for (const [user, itemTitle, filename] of [
    [bob, 'Everyday backpack', 'backpack.jpg'],
    [carol, 'A field guide', 'books.jpg'],
    [dan, 'Little potted cactus', 'plant.jpg'],
  ]) {
    const listing = await api(
      '/listings',
      user,
      {
        title: itemTitle,
        description: 'Synthetic local browser verification.',
        condition: 'good',
      },
      'POST',
    );
    const photoResponse = await fetch(
      `${apiOrigin}/api/v1/listings/${listing.id}/photos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${user.token}`,
          'Content-Type': 'image/jpeg',
        },
        body: await readFile(
          new URL(`../src/assets/${filename}`, import.meta.url),
        ),
      },
    );
    assert.equal(photoResponse.status, 201);
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
      '4196',
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
      /* Startup is bounded. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Local production preview started');
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  // Theme contrast audits must inspect settled colors, not transition frames.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', () => errors.push('Browser error'));
  // A local magic-link session supplies a real signed JWT via the normal SDK callback.
  // No direct browser storage writes and no application API or data mocks.
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
      json: { ...alice.session, expires_in: 3600, token_type: 'bearer' },
    }),
  );
  await page.goto(`${origin}/listings/new`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(`${origin}/listings/new`);
  // Publish through the real production form, then read it from a separate
  // signed-out browser context. The catalogue is not pre-seeded with this item.
  await expect(
    page.getByRole('heading', { name: 'List an item', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page
    .getByLabel('Description', { exact: true })
    .fill('A camera ready for another outing.');
  const publication = page.waitForResponse(
    (response) =>
      response.url() === `${apiOrigin}/api/v1/listings` &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create item', exact: true }).click();
  const response = await publication;
  assert.equal(response.status(), 201);
  const item = await response.json();
  assert.equal(item.ownerId, alice.id);
  assert.equal(item.title, title);
  assert.equal(item.availability, 'available');
  const visitor = await browser.newContext({ reducedMotion: 'reduce' });
  const publicPage = await visitor.newPage();
  await publicPage.goto(`${origin}/listings/${item.id}`);
  await expect(
    publicPage.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole('link', { name: 'Local Alice', exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByRole('link', { name: 'Edit item', exact: true }),
  ).toHaveCount(0);
  await visitor.close();
  await page.goto(`${origin}/listings/${item.id}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit item' })).toBeVisible();
  await page.getByLabel('Choose photos').setInputFiles({
    name: 'camera.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(
      new URL('../src/assets/camera.jpg', import.meta.url),
    ),
  });
  await page.getByRole('button', { name: 'Upload selected photos' }).click();
  await expect(page.getByText('1 of 3 photos selected.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove photo 1' }),
  ).toBeVisible();
  const stored = await api(`/listings/${item.id}/photos`);
  assert.equal(stored.length, 1);
  assert.equal((await fetch(stored[0].url)).status, 200);
  await page.goto(
    `${origin}/browse?q=${marker}&condition=good&availability=available&sort=oldest`,
  );
  const image = page.getByRole('img', { name: `${title}, photo 1` });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBe(true);
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('link', { name: 'Local Alice' }).click();
  await expect(
    page.getByRole('heading', { name: 'Local Alice' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('searchbox', { name: 'Search items', exact: true }),
  ).toHaveValue(marker);
  await expect(
    page.getByRole('combobox', { name: 'Condition', exact: true }),
  ).toHaveValue('good');
  await expect(
    page.getByRole('combobox', { name: 'Sort', exact: true }),
  ).toHaveValue('oldest');
  await expect(image).toBeVisible();
  await page.reload();
  await expect(image).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
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
      if ([360, 1600].includes(width))
        await page.screenshot({
          path: new URL(`browse-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
    await page.goto(`${origin}/?interest=${interests[0].id}`);
    await expect(
      page
        .locator('.member-grid')
        .getByRole('link', { name: 'Local Bob', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('.member-grid')
        .getByRole('link', { name: 'Local Carol', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('2 shared interests', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('1 shared interest', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.member-grid').getByText('Local Dan', { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(page.locator('.development-preview')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
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
      if ([360, 1600].includes(width))
        await page.screenshot({
          path: new URL(`home-${theme}-${width}.png`, output).pathname,
          fullPage: true,
        });
    }
    await page.goto(
      `${origin}/browse?q=${marker}&condition=good&availability=available&sort=oldest`,
    );
  }
  const anonymousContext = await browser.newContext({
    reducedMotion: 'reduce',
  });
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto(origin);
  await expect(anonymous.getByRole('link', { name: title })).toBeVisible();
  await expect(
    anonymous.getByText('Sign in to see your shared interests.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(anonymous.getByText(/\d shared interests?/)).toHaveCount(0);
  await page.goto(`${origin}/browse?q=unmatched${marker}`);
  await expect(
    page.getByRole('heading', { name: 'No items to show yet' }),
  ).toBeVisible();
  // Disconnect the actual API, then recover it: no frontend success fixtures.
  await new Promise((resolve) => server.close(resolve));
  await page.goto(`${origin}/browse?q=${marker}`);
  await expect(page.getByRole('alert')).toBeVisible();
  server.listen(4316, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  assert.deepEqual(errors, []);
  console.info(
    'Local production browser: real JWT/API/database/Storage form publication and independent public read, upload, search, owner profile, Back/reload filters, public and personalized discovery, empty/error/recovery, both themes at 360/768/800/1280/1600px and axe passed. External OAuth handoff was simulated; application data was real and synthetic.',
  );
} finally {
  await browser?.close();
  if (preview?.pid) process.kill(-preview.pid, 'SIGTERM');
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await fixture.migration.query(
    'DELETE FROM public.profile_interests WHERE profile_id=ANY($1::uuid[]) AND interest_id=ANY($2::uuid[])',
    [fixture.users.map((user) => user.id), fixtureInterestIds],
  );
  await fixture.migration.query(
    'DELETE FROM public.interests i WHERE id=ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM public.profile_interests p WHERE p.interest_id=i.id)',
    [fixtureInterestIds],
  );
  await fixture.cleanup();
}
