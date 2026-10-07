// Verify the already-seeded isolated development app; no resets or fixture deletion.
import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import console from 'node:console';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const origin = 'http://127.0.0.1:5173';
const apiOrigin = 'http://127.0.0.1:3001';
const state = JSON.parse(
  await readFile(
    new URL(
      '../../../packages/database/.demo.local/state.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const credentials = JSON.parse(
  await readFile(
    new URL(
      '../../../packages/database/.demo.local/credentials.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
assert.equal(credentials.authUrl, 'http://127.0.0.1:55431');
const ready = JSON.parse(
  await readFile(
    new URL(
      '../../../packages/database/.demo.local/ready.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
assert.equal(
  ready.guestId,
  credentials.accounts.find((account) => account.key === 'guest').id,
);
const id = (key) => state.steps[key].result.id;
const output = new URL('../test-results/demo-local/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
let stage = 'home';
let violations = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const requestFailures = [];
  page.on('response', (response) => {
    if (
      response.url().startsWith(`${apiOrigin}/api/v1`) &&
      response.status() >= 400
    )
      requestFailures.push(response.status());
  });
  await page.goto(`${origin}/`);
  await expect(page.locator('.listing-photo').first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.listing-photo')
        .evaluateAll(
          (images) =>
            images.filter((image) => image.complete && image.naturalWidth > 0)
              .length,
        ),
    )
    .toBeGreaterThanOrEqual(4);
  await page.screenshot({
    path: new URL('home-light.png', output).pathname,
    fullPage: true,
  });
  await page.getByLabel('Theme').selectOption('dark');
  await page.screenshot({
    path: new URL('home-dark.png', output).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.screenshot({
    path: new URL('home-mobile-dark.png', output).pathname,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('Theme').selectOption('light');
  stage = 'browse';
  await page.goto(`${origin}/browse`);
  await expect(page.locator('.listing-photo').first()).toBeVisible();
  await page.screenshot({
    path: new URL('browse-light.png', output).pathname,
    fullPage: true,
  });
  stage = 'gallery';
  await page.goto(`${origin}/listings/${id('listing/camera')}`);
  await expect(
    page.getByRole('heading', { name: 'Camera starter kit', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator('.listing-photo').count())
    .toBeGreaterThanOrEqual(2);
  stage = 'member';
  await page.goto(`${origin}/members/${id('profile/lea')}`);
  await expect(
    page.getByRole('heading', { name: 'Léa Martin', exact: true }).first(),
  ).toBeVisible();

  stage = 'sign-in';
  await page.goto(`${origin}/sign-in?next=/shelf`);
  await expect(
    page.getByRole('button', { name: 'Continue as guest' }),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const audit = await new AxeBuilder({ page }).analyze();
      violations = audit.violations.map(({ id, impact }) => ({ id, impact }));
      assert.deepEqual(
        audit.violations.map(({ id, impact }) => ({ id, impact })),
        [],
      );
    }
  }
  stage = 'guest-session';
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page).toHaveURL(`${origin}/shelf`);
  await expect(page.locator('.shelf-item')).toHaveCount(10);
  await page.reload();
  await expect(page.locator('.shelf-item')).toHaveCount(10);
  stage = 'swaps';
  await page.goto(`${origin}/swaps`);
  await expect(
    page.getByRole('link', { name: 'View swap', exact: true }),
  ).toHaveCount(9);
  for (const key of [
    'confirmed-plants',
    'completed-books',
    'group-weekend',
    'disputed-bicycle',
  ]) {
    await page.goto(`${origin}/swaps/${id(`trade/${key}`)}`);
    await expect(
      page.getByRole('region', { name: 'Swap lifecycle' }),
    ).toBeVisible();
  }
  stage = 'inbox';
  await page.goto(`${origin}/inbox`);
  await expect(page.locator('.conversation-list > li')).toHaveCount(7);
  await page.locator('.conversation-list a').first().click();
  await expect(page.getByRole('textbox', { name: /message/i })).toBeVisible();
  stage = 'group-invitation';
  const invitation = state.steps['trade/group-invitation'].result.id;
  await page.goto(`${origin}/swaps/${invitation}`);
  await expect(
    page.getByRole('button', { name: /join.*chat|accept.*invitation/i }),
  ).toBeVisible();
  stage = 'notifications';
  await page.getByRole('button', { name: /Open notifications/ }).click();
  await expect(page.locator('.notification-list > li').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(`${origin}/listings/${id('listing/headphones')}/edit`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
    'Over-ear headphones',
  );
  stage = 'profile';
  await page.goto(`${origin}/account/profile`);
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Camille Demo',
  );
  stage = 'settings';
  await page.goto(`${origin}/account/settings`);
  await expect(
    page.getByRole('heading', { name: 'Account settings' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue as guest' }),
  ).toBeVisible();
  // The form works for a different synthetic account and does not retain guest data.
  stage = 'second-account';
  const member = credentials.accounts.find((account) => account.key === 'lea');
  await page.getByLabel('Email', { exact: true }).fill(member.email);
  await page.getByLabel('Password', { exact: true }).fill(member.password);
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await expect(
    page.getByRole('button', { name: 'Open account' }),
  ).toBeVisible();
  await page.goto(`${origin}/shelf`);
  await expect(page.locator('.shelf-item')).toHaveCount(3);
  await expect(
    page.getByRole('heading', { name: 'Everyday navy backpack', exact: true }),
  ).toHaveCount(0);
  assert.deepEqual(requestFailures, []);
  console.info(
    'Local demo browser passed: public catalogue/images, guest SDK session/reload, shelf, nine swaps, seven conversations, group invitation, notifications, editor/profile/settings, logout, second-account form isolation, and responsive sign-in axe checks.',
  );
} catch (error) {
  // Never output screenshot/page text, passwords, session data or private records.
  const locations =
    String(error?.stack ?? '').match(/local-demo\.mjs:\d+:\d+/g) ?? [];
  console.error(
    JSON.stringify({
      error: 'Local demo browser verification failed',
      stage,
      locations,
      violations,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
