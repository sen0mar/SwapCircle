import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { CurrentProfile } from '@swapcircle/contracts';
import { signInFixture } from './auth-fixture';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const id = 'a8ded912-c170-4988-8750-9747558e8a87';
const interest = {
  id: '4d3d3b3f-0543-4b15-b08a-5340d5633973',
  name: 'Gardening',
};
const timestamps = {
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
};

test('avatar preview, failed upload retry, public display and removal', async ({
  page,
}) => {
  // Audit settled colors rather than intermediate theme-transition frames.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  let avatarUrl: string | null = null;
  let avatarCleanupPending = false;
  let attempts = 0;
  const image = readFileSync(
    fileURLToPath(new URL('../src/assets/backpack.jpg', import.meta.url)),
  );
  const current = () => ({
    id,
    displayName: 'Ada Garden',
    biography: '',
    approximateLocation: '',
    interests: [],
    avatarUrl,
    avatarCleanupPending,
    ...timestamps,
  });
  const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' };
  await page.route('**/api/v1/interests', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({ headers, json: current() }),
  );
  await page.route('**/api/v1/profiles/me/avatar', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type',
        },
      });
    if (route.request().method() === 'POST') {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          headers,
          json: {
            error: {
              code: 'PHOTO_STORAGE_UNAVAILABLE',
              message: 'Retry.',
              requestId: crypto.randomUUID(),
            },
          },
        });
      avatarUrl = 'http://127.0.0.1:4173/src/assets/backpack.jpg';
      avatarCleanupPending = true;
      return route.fulfill({ status: 201, headers, json: current() });
    }
    avatarUrl = null;
    avatarCleanupPending = true;
    return route.fulfill({ headers, json: current() });
  });
  await page.route('**/api/v1/profiles/me/avatar/cleanup', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type',
        },
      });
    avatarCleanupPending = false;
    return route.fulfill({ headers, json: current() });
  });
  await page.route(`**/api/v1/members/${id}`, (route) =>
    route.fulfill({
      headers,
      json: {
        id,
        displayName: 'Ada Garden',
        biography: '',
        approximateLocation: '',
        interests: [],
        avatarUrl,
      },
    }),
  );
  await signInFixture(page);
  await page.goto('/account/profile');
  await page.getByLabel('Choose avatar').setInputFiles({
    name: 'avatar.jpg',
    mimeType: 'image/jpeg',
    buffer: image,
  });
  await expect(
    page.getByRole('img', { name: 'Selected avatar preview' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Upload avatar' }).click();
  await expect(
    page.getByText('Your selection is still here', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Upload avatar' }).click();
  await expect(
    page.getByRole('img', { name: "Ada Garden's avatar" }),
  ).toBeVisible();
  await expect(
    page.getByText('A previous avatar is waiting', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry avatar cleanup' }).click();
  await expect(
    page.getByText('A previous avatar is waiting', { exact: false }),
  ).toHaveCount(0);
  await page.goto(`/members/${id}`);
  await expect(
    page.getByRole('img', { name: "Ada Garden's avatar" }),
  ).toBeVisible();
  await page.goto('/account/profile');
  await page.getByRole('button', { name: 'Remove avatar' }).click();
  await expect(
    page.getByRole('img', { name: 'Ada Garden has no available avatar' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retry avatar cleanup' }).click();
  await expect(
    page.getByRole('button', { name: 'Retry avatar cleanup' }),
  ).toHaveCount(0);
  await page.getByLabel('Theme').selectOption('dark');
  await page.setViewportSize({ width: 360, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('profile draft, save, reload and public second session', async ({
  page,
  browser,
}) => {
  let profile: CurrentProfile = {
    id,
    displayName: 'Member',
    biography: '',
    approximateLocation: '',
    interests: [],
    avatarUrl: null,
    avatarCleanupPending: false,
    ...timestamps,
  };
  let failSave = true;

  await page.route('**/api/v1/interests', (route) =>
    route.fulfill({ json: [interest] }),
  );
  await page.route('**/api/v1/profiles/me', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type',
        },
      });

    if (route.request().method() === 'PUT') {
      if (failSave) {
        failSave = false;
        return route.fulfill({
          status: 503,
          headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' },
          json: {
            error: {
              code: 'TEMPORARY',
              message: 'Try again.',
              requestId: crypto.randomUUID(),
            },
          },
        });
      }

      const update = route.request().postDataJSON();
      profile = {
        ...profile,
        displayName: update.displayName,
        biography: update.biography,
        approximateLocation: update.approximateLocation,
        interests: update.interestIds.includes(interest.id) ? [interest] : [],
      };
    }

    return route.fulfill({
      headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' },
      json: profile,
    });
  });
  await page.route(`**/api/v1/members/${id}`, (route) =>
    route.fulfill({
      json: {
        id: profile.id,
        displayName: profile.displayName,
        biography: profile.biography,
        approximateLocation: profile.approximateLocation,
        interests: profile.interests,
      },
    }),
  );

  await signInFixture(page);
  await page.goto('/account/profile');
  await page.getByLabel('Display name').fill('');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('alert')).toContainText(
    /display name|too small/i,
  );
  await page.getByLabel('Display name').fill('Ada Garden');
  await page.getByLabel('Biography').fill('I grow herbs and repair things.');
  await page.getByLabel('Approximate location').fill('Paris');
  await page.getByLabel('Gardening').check();
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.getByLabel('Biography')).toHaveValue(
    'I grow herbs and repair things.',
  );
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(
    page.getByText('Your draft is still here', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Garden');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Garden');
  await expect(page.getByLabel('Biography')).toHaveValue(
    'I grow herbs and repair things.',
  );
  await expect(page.getByLabel('Gardening')).toBeChecked();
  await page.screenshot({
    path: 'test-results/profile-editor-desktop.png',
    fullPage: true,
  });

  const other = await browser.newContext();
  const publicPage = await other.newPage();
  await publicPage.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      json: {
        id: '3e60897a-a3cc-4d60-9425-e39203a6282a',
        displayName: 'Second member',
        biography: '',
        approximateLocation: '',
        interests: [],
        ...timestamps,
      },
    }),
  );
  await signInFixture(
    publicPage,
    '/account',
    '3e60897a-a3cc-4d60-9425-e39203a6282a',
  );
  await publicPage.route(`**/api/v1/members/${id}`, (route) =>
    route.fulfill({
      json: {
        id: profile.id,
        displayName: profile.displayName,
        biography: profile.biography,
        approximateLocation: profile.approximateLocation,
        interests: profile.interests,
      },
    }),
  );
  await publicPage.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await publicPage.goto(`/members/${id}`);
  await expect(
    publicPage.getByRole('heading', { name: 'Ada Garden' }),
  ).toBeVisible();
  await expect(
    publicPage.getByText('I grow herbs and repair things.'),
  ).toBeVisible();
  await expect(publicPage.getByText('Gardening')).toBeVisible();
  await publicPage.screenshot({
    path: 'test-results/public-member-second-session.png',
    fullPage: true,
  });
  await expect(
    publicPage.getByText('No available items shared yet.', { exact: true }),
  ).toBeVisible();
  // Inspect the public member output for internal profile and meeting fields.
  expect(
    await publicPage
      .getByRole('region', { name: 'Ada Garden', exact: true })
      .innerHTML(),
  ).not.toMatch(
    /createdAt|updatedAt|interestIds|credential|moderation|meeting/i,
  );
  await other.close();
});

test('drawer focus and sign-out at mobile and desktop widths', async ({
  page,
}) => {
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      json: {
        id,
        displayName: 'Ada Garden',
        biography: '',
        approximateLocation: 'Paris',
        interests: [],
        ...timestamps,
      },
    }),
  );
  await signInFixture(page);

  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Open account' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Account' });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText('Ada Garden', { exact: false }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/profile-drawer-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }

  await page.getByRole('button', { name: 'Open account' }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('link', { name: 'Edit profile' })
    .click();
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(page.getByRole('dialog', { name: 'Account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account' }).click();
  await page
    .getByRole('dialog', { name: 'Account' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Account' })).toHaveCount(0);
});
