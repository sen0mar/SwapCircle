// Real local Express/PostgreSQL and production browser with synthetic accounts.
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { randomUUID, createHmac } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout } from 'node:timers';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDiscoveryFixture } from '../../api/test/discovery-fixture.mjs';

const fetch = globalThis.fetch;

const origin = 'http://127.0.0.1:4211';
const apiOrigin = 'http://127.0.0.1:4331';
const fixture = await createDiscoveryFixture(origin);
const server = fixture.app.listen(4331, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const [alice, bob, stranger] = fixture.users;
const interests = (
  await fixture.migration.query(
    'SELECT id, name FROM public.interests ORDER BY id LIMIT 3',
  )
).rows;
const output = new URL('../test-results/accessibility-local/', import.meta.url);
let preview;
let browser;
let failure;

function stopPreview() {
  if (!preview || preview.exitCode !== null) return;

  try {
    process.kill(-preview.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

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
  assert.equal(
    await fetch(origin).then(
      () => true,
      () => false,
    ),
    false,
    'Accessibility preview port must be unused.',
  );
  for (const [index, user] of [alice, bob, stranger].entries())
    await api(
      '/profiles/me',
      user,
      {
        displayName: ['Access Alice', 'Access Bob', 'Access Carol'][index],
        biography: 'Synthetic accessibility audit member.',
        approximateLocation: 'Paris area',
        interestIds: interests.slice(0, 2).map((i) => i.id),
      },
      'PUT',
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
      '4211',
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
    assert.equal(
      preview.exitCode,
      null,
      'Accessibility preview exited during startup.',
    );
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready);
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  const a = await (
    await browser.newContext({
      reducedMotion: 'reduce',
      timezoneId: 'Europe/Paris',
    })
  ).newPage();
  const b = await (
    await browser.newContext({
      reducedMotion: 'reduce',
      timezoneId: 'Europe/Paris',
    })
  ).newPage();
  const errors = [];
  for (const page of [a, b])
    page.on('pageerror', (e) => errors.push(e.message));
  await signIn(a, alice, '/account');
  await signIn(b, bob, '/account');

  const audit = async (page, name, capture = false) => {
    await expect(page.locator('main')).toBeVisible();
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.document
            .getAnimations()
            .filter((animation) => animation.playState === 'running').length,
      ),
      0,
      `Reduced motion: ${name}`,
    );
    const overflow = await page.evaluate(() =>
      [...globalThis.document.querySelectorAll('main *')]
        .filter(
          (el) => el.getBoundingClientRect().right > globalThis.innerWidth,
        )
        .map((el) => ({
          tag: el.tagName,
          className: el.className,
          width: el.getBoundingClientRect().width,
        })),
    );
    if (overflow.length)
      await page.screenshot({
        path: new URL('overflow-diagnostic.png', output).pathname,
        fullPage: true,
      });
    assert.ok(
      await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth <=
          globalThis.innerWidth,
      ),
      `Page overflow: ${name}: ${JSON.stringify(overflow)}`,
    );
    const weakBorders = await page.evaluate(() => {
      const luminance = (value) => {
        const channels = value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map((n) => {
            const c = Number(n) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      return [
        ...globalThis.document.querySelectorAll(
          '.ui-input:not(:disabled), .proposal-content select, .catalog-filters select, .member-interest-filter select, .trade-lifecycle-dialog select, .trade-lifecycle-dialog textarea',
        ),
      ]
        .filter((el) => {
          const css = globalThis.getComputedStyle(el);
          const border = luminance(css.borderTopColor);
          const background = luminance(css.backgroundColor);
          return (
            (Math.max(border, background) + 0.05) /
              (Math.min(border, background) + 0.05) <
            3
          );
        })
        .map((el) => el.id || el.className);
    });
    assert.deepEqual(weakBorders, [], `Control contrast: ${name}`);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    assert.deepEqual(
      violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      `Axe: ${name}`,
    );
    if (capture) {
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await page.screenshot({
        path: new URL(`${name}.png`, output).pathname,
        fullPage: true,
      });
    }
  };
  const keyboardOpen = async (page, trigger) => {
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      assert.ok(
        await page
          .getByRole('dialog')
          .evaluate((el) => el.contains(globalThis.document.activeElement)),
      );
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  };
  const activate = async (page, control) => {
    await control.focus();
    await page.keyboard.press('Enter');
  };
  const publish = async (page, title) => {
    await page.goto(`${origin}/listings/new`);
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page
      .getByLabel('Description', { exact: true })
      .fill(
        'Synthetic item with readable terms and no real owner information.',
      );
    await page
      .getByRole('button', { name: 'Create item', exact: true })
      .click();
    await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+\/edit$/);
    return page.url().split('/').at(-2);
  };
  await a.goto(`${origin}/account/profile`);
  await a.setViewportSize({ width: 360, height: 900 });
  await expect(a.getByLabel('Display name')).toBeVisible();
  await audit(a, 'profile-initial-mobile');
  let completedId;
  // A separate complete swap through production UI for each theme/device pairing.
  for (const theme of ['light', 'dark'])
    for (const width of [360, 1280]) {
      for (const page of [a, b]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByLabel('Theme').selectOption(theme);
      }
      const title = `Access ${theme} ${width} ` + 'LongUnbrokenTerm'.repeat(6);
      const own = await publish(a, title);
      const offered = await publish(b, `Offered ${theme} ${width}`);
      await a.goto(`${origin}/listings/${offered}`);
      await expect(a.getByRole('dialog')).toHaveCount(0);
      await keyboardOpen(a, a.getByRole('button', { name: 'Propose a trade' }));
      await activate(a, a.getByRole('button', { name: 'Propose a trade' }));
      await a.getByRole('checkbox', { name: title }).focus();
      await a.keyboard.press('Space');
      await activate(a, a.getByRole('button', { name: 'Review proposal' }));
      await audit(a, `proposal-${theme}-${width}`, true);
      await activate(a, a.getByRole('button', { name: 'Send proposal' }));
      await expect(a).toHaveURL(/\/swaps\/[0-9a-f-]+$/);
      const id = a.url().split('/').pop();
      completedId = id;
      await expect(a.getByRole('dialog')).toHaveCount(0);
      for (const page of [a, b]) {
        if (page === b) await page.goto(`${origin}/swaps/${id}`);
        await page
          .getByRole('button', { name: 'Review current terms' })
          .click();
        await activate(
          page,
          page.getByRole('button', { name: 'Accept version 1' }),
        );
      }
      await a.getByRole('button', { name: 'Refresh swap status' }).click();
      await expect(
        a.getByRole('button', { name: 'Confirm my receipt' }),
      ).toBeVisible();
      const meeting = a.getByRole('region', {
        name: 'Meeting arrangement',
        exact: true,
      });
      await meeting
        .getByRole('button', { name: 'Plan meeting', exact: true })
        .click();
      await meeting
        .getByLabel('Public meeting place')
        .fill('Synthetic public library entrance');
      await meeting.getByLabel('Arrangement time zone').fill('Europe/Paris');
      await meeting
        .getByLabel('Date and time in arrangement zone')
        .fill('2026-11-03T12:00');
      await meeting.getByRole('button', { name: 'Save meeting' }).click();
      await expect(
        meeting.getByRole('heading', { name: 'Arrangement 1', exact: true }),
      ).toBeVisible();
      await meeting
        .getByRole('button', { name: 'Confirm this meeting' })
        .click();
      await b
        .getByRole('button', { name: 'Refresh meeting', exact: true })
        .click();
      await b.getByRole('button', { name: 'Confirm this meeting' }).click();
      await audit(a, `confirmed-${theme}-${width}`, true);
      for (const page of [a, b]) {
        await keyboardOpen(
          page,
          page.getByRole('button', { name: 'Confirm my receipt' }),
        );
        await activate(
          page,
          page.getByRole('button', { name: 'Confirm my receipt' }),
        );
        await page
          .getByRole('button', { name: 'I received all my items' })
          .click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
      }
      await a.getByRole('button', { name: 'Refresh swap status' }).click();
      await expect(
        a.getByText('Everyone acknowledged receipt', { exact: false }).first(),
      ).toBeVisible();
      assert.equal((await api(`/trades/${id}`, alice)).status, 'completed');
      const rows = (
        await fixture.migration.query(
          'SELECT availability FROM public.listings WHERE id=ANY($1::uuid[])',
          [[own, offered]],
        )
      ).rows;
      assert.ok(rows.every((r) => r.availability === 'exchanged'));
      await audit(a, `completed-${theme}-${width}`, true);
    }
  const available = await api(
    '/listings',
    bob,
    {
      title: 'UnbrokenListingTitle'.repeat(6),
      description: 'LongDescription'.repeat(100),
      condition: 'good',
    },
    'POST',
  );
  const conversation = await api(
    '/conversations/direct',
    alice,
    { userId: bob.id },
    'POST',
  );
  const threadId = conversation.id;
  await api(
    '/conversations/messages',
    bob,
    {
      conversation_id: threadId,
      client_message_id: randomUUID(),
      body: 'LongMessage'.repeat(100),
    },
    'POST',
  );
  const notification = (
    await fixture.migration.query(
      'SELECT id FROM public.notifications WHERE recipient_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 1',
      [alice.id, completedId],
    )
  ).rows[0];
  assert.ok(notification);
  const paths = [
    '/',
    '/browse',
    `/listings/${available.id}`,
    `/members/${bob.id}`,
    '/account',
    '/account/profile',
    '/account/settings',
    '/shelf',
    '/listings/new',
    '/swaps',
    `/swaps/${completedId}`,
    '/inbox',
    `/inbox/${threadId}`,
    `/notifications/${notification.id}`,
  ];
  // Explicit text enlargement: root font at 200%, distinct from viewport/zoom emulation.
  for (const theme of ['light', 'dark']) {
    await a.getByLabel('Theme').selectOption(theme);
    for (const path of paths) {
      await a.goto(`${origin}${path}`);
      await expect(a.locator('main h1').first()).toBeVisible();
      if (path.includes('/inbox/'))
        await expect(a.getByLabel('Message draft')).toBeVisible();
      for (const width of [360, 768, 1280, 1600]) {
        await a.setViewportSize({ width, height: 900 });
        await audit(
          a,
          `route-${paths.indexOf(path)}-${theme}-${width}`,
          width === 360 || width === 1280,
        );
      }
      await a.setViewportSize({ width: 768, height: 900 });
      await a.evaluate(
        () => (globalThis.document.documentElement.style.fontSize = '200%'),
      );
      await audit(a, `text200-${paths.indexOf(path)}-${theme}`, true);
      assert.equal(
        await a
          .locator('html')
          .evaluate((el) => globalThis.getComputedStyle(el).fontSize),
        '32px',
      );
      await a.evaluate(() =>
        globalThis.document.documentElement.style.removeProperty('font-size'),
      );
    }
    await a.setViewportSize({ width: 360, height: 900 });
    await a.goto(`${origin}/inbox/${threadId}`);
    await a.getByLabel('Message draft').fill('Keep keyboard navigation draft');
    const back = a.getByRole('link', { name: 'Back to conversations' });
    await back.focus();
    await a.keyboard.press('Enter');
    const link = a.locator(`a[href="/inbox/${threadId}"]`).last();
    await expect(link).toBeFocused();
    await a.keyboard.press('Enter');
    await expect(a.getByLabel('Message draft')).toHaveValue(
      'Keep keyboard navigation draft',
    );
    await expect(
      a.getByRole('heading', { name: 'Access Bob', exact: true }),
    ).toBeFocused();
    await keyboardOpen(a, a.getByRole('button', { name: 'Open account' }));
    await expect(a.getByLabel('Message draft')).toHaveValue(
      'Keep keyboard navigation draft',
    );
    await a.getByRole('button', { name: 'Open account' }).click();
    await a.reload();
    await expect(a.getByRole('dialog')).toHaveCount(0);
    assert.ok(
      await a.evaluate(
        () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    );
    assert.equal(await a.locator('.quiet-skeleton').count(), 0);
  }

  // Generate an actually expired synthetic JWT using only the guarded local stack key.
  // Neither key nor token is logged, persisted, or placed in browser storage.
  const status = JSON.parse(
    execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], {
      cwd: new URL('../../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.equal(status.API_URL, fixture.publicAuth.url);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: alice.id,
    aud: 'authenticated',
    role: 'authenticated',
    iss: `${fixture.publicAuth.url}/auth/v1`,
    iat: 1,
    exp: 2,
  });
  const signed = `${header}.${payload}`;
  const expired = `${signed}.${createHmac('sha256', status.JWT_SECRET).update(signed).digest('base64url')}`;
  const expiredResponse = await fetch(`${apiOrigin}/api/v1/identity`, {
    headers: { Authorization: `Bearer ${expired}` },
  });
  assert.equal(expiredResponse.status, 401);
  const rejected = await expiredResponse.json();
  assert.equal(rejected.error.code, 'UNAUTHORIZED');

  // Let the unchanged 60-second local write burst window finish before recovery cases.
  // This is deliberate pacing, not an assertion retry or a quota override.
  console.info(
    'Waiting for the local write burst window before recovery scenarios.',
  );
  await new Promise((resolve) => setTimeout(resolve, 61000));
  for (const theme of ['light', 'dark'])
    for (const width of [360, 1280]) {
      await a.getByLabel('Theme').selectOption(theme);
      await a.setViewportSize({ width, height: 900 });
      for (const form of ['listing', 'profile']) {
        const profile = form === 'profile';
        await a.goto(
          `${origin}${profile ? '/account/profile' : '/listings/new'}`,
        );
        const field = a.getByLabel(profile ? 'Display name' : 'Title', {
          exact: true,
        });
        const submit = a.getByRole('button', {
          name: profile ? 'Save profile' : 'Create item',
          exact: true,
        });
        await field.fill(' ');
        await submit.click();
        await expect(
          a.getByText(
            profile ? 'Enter a display name.' : 'Enter an item title.',
            { exact: true },
          ),
        ).toBeVisible();
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(field).toBeFocused();
        await audit(a, `invalid-${form}-${theme}-${width}`, true);
        const draft = `Recoverable ${form} ${theme} ${width}`;
        await field.fill(draft);
        if (!profile)
          await a
            .getByLabel('Description', { exact: true })
            .fill('Synthetic recoverable draft.');
        const path = profile ? '**/api/v1/profiles/me' : '**/api/v1/listings';
        const fail = async (route) => {
          if (route.request().method() === (profile ? 'PUT' : 'POST'))
            await route.abort('failed');
          else await route.continue();
        };
        await a.route(path, fail);
        await submit.click();
        await expect(
          a.getByRole('alert').filter({ hasText: /draft is still here/ }),
        ).toBeVisible();
        await expect(field).toHaveValue(draft);
        await audit(a, `offline-${form}-${theme}-${width}`, true);
        await a.unroute(path, fail);
        const expiredStatuses = [];
        const expire = async (route) => {
          if (route.request().method() !== (profile ? 'PUT' : 'POST'))
            return route.continue();
          const response = await route.fetch({
            headers: {
              ...route.request().headers(),
              authorization: `Bearer ${expired}`,
            },
          });
          expiredStatuses.push(response.status());
          await route.fulfill({ response });
        };
        await a.route(path, expire);
        await submit.click();
        await expect(
          a
            .getByRole('alert')
            .filter({ hasText: /session could not be verified/ }),
        ).toBeVisible();
        assert.deepEqual(expiredStatuses, [401]);
        await expect(field).toHaveValue(draft);
        await audit(a, `expired-${form}-${theme}-${width}`, true);
        await a.unroute(path, expire);
        await submit.click();
        if (profile)
          await expect(
            a.getByText('Profile saved.', { exact: true }),
          ).toBeVisible();
        else await expect(a).toHaveURL(/\/listings\/[0-9a-f-]+\/edit$/);
      }
    }
  // A failed notification status fetch must preserve its notification and recover in place.
  await a.route(`**/api/v1/trades/${completedId}`, (route) =>
    route.abort('failed'),
  );
  await a.goto(`${origin}/notifications/${notification.id}`);
  await expect(
    a.getByRole('button', { name: 'Retry swap status' }),
  ).toBeVisible();
  await a.unroute(`**/api/v1/trades/${completedId}`);
  await a.getByRole('button', { name: 'Retry swap status' }).click();
  await expect(a.getByText(/Everyone acknowledged receipt/)).toBeVisible();
  // Explicit account recovery clears private forms and channels via the real SDK sign-out.
  await a.goto(`${origin}/account`);
  await a.getByRole('button', { name: 'Open account' }).click();
  await a.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    a.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  await expect(a.getByRole('dialog')).toHaveCount(0);
  await expect(a.getByLabel('Message draft')).toHaveCount(0);
  await audit(a, 'signed-out-recovery', true);
  assert.deepEqual(errors, []);
  console.info(
    'Accessibility journey passed: four complete UI swaps, fourteen routes, Light/Dark 360/768/1280/1600, 200% text, keyboard focus/drafts, reduced motion, invalid/offline/actually expired authorization, retry and logout.',
  );
} catch (error) {
  failure = error;
} finally {
  const closed = await Promise.allSettled([
    browser?.close(),
    Promise.resolve().then(stopPreview),
  ]);
  server.close();
  for (const result of closed)
    if (result.status === 'rejected') failure ??= result.reason;
  try {
    await fixture.cleanup();
  } catch (error) {
    failure ??= error;
  }
}

if (failure) throw failure;
