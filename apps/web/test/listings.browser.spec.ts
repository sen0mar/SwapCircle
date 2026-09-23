import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInFixture } from './auth-fixture';

const ownerId = 'a8ded912-c170-4988-8750-9747558e8a87';
const id = '7911f95a-c9df-4831-b4bf-8203dbd6aad7';
const secondId = 'abf31a4b-4f9c-4ddb-a067-6e4a162170da';
const item = {
  id,
  ownerId,
  title: 'A well-loved field guide',
  description:
    '<script>not executable</script>\n' + 'Long description '.repeat(200),
  condition: 'good',
  availability: 'available',
  revision: 1,
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
};
const profile = {
  id: ownerId,
  displayName: 'Garden Member',
  approximateLocation: 'Paris area',
  biography: 'I repair and reuse.',
  interests: [],
};

test('public cursor navigation, reload, owner profile, long text and accessible themes', async ({
  page,
}) => {
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('cursor')
        ? {
            items: [{ ...item, id: secondId, title: 'Second item' }],
            nextCursor: null,
          }
        : { items: [item], nextCursor: 'stable-cursor' },
    }),
  );
  await page.route(`**/api/v1/listings/${id}`, (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: item });
  });
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({ json: profile }),
  );
  await page.goto('/browse');
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(
    page.getByRole('heading', { name: 'Second item' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: item.title })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Second item' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'First page' }).click();
  const link = page.getByRole('link', { name: item.title });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
  await page.reload();
  await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await expect(
    page.getByText('<script>not executable</script>', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit item' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Message', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Propose a trade' }),
  ).toBeDisabled();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 800, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.screenshot({
      path: `test-results/listing-${theme}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('link', { name: profile.displayName }).click();
  await expect(
    page.getByRole('heading', { name: profile.displayName }),
  ).toBeVisible();
});

test('loading, recoverable failure, empty and withdrawn states', async ({
  page,
}) => {
  let fail = true;
  await page.route('**/api/v1/listings?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill(
      fail
        ? { status: 503, json: {} }
        : { json: { items: [], nextCursor: null } },
    );
  });
  await page.goto('/browse');
  await expect(page.getByRole('status')).toHaveText('Loading items…');
  await expect(page.getByRole('alert')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No items to show yet' }),
  ).toBeVisible();
  let detailStatus = 503;
  await page.route(`**/api/v1/listings/${id}`, (route) =>
    route.fulfill({ status: detailStatus, json: {} }),
  );
  await page.goto(`/listings/${id}`);
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible();
  detailStatus = 404;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(
    page.getByText('This item cannot be found or has been withdrawn.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry', exact: true }),
  ).toHaveCount(0);
});

test('only owners see the truthful edit limitation', async ({ page }) => {
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      json: {
        ...profile,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({ json: profile }),
  );
  await page.route(`**/api/v1/listings/${id}`, (route) =>
    route.fulfill({ json: item }),
  );
  await signInFixture(page);
  await page.goto(`/listings/${id}`);
  await expect(page.getByRole('button', { name: 'Edit item' })).toBeDisabled();
  await expect(
    page.getByText('This is your item. Listing editing is not available yet.'),
  ).toBeVisible();
  await expect(page.locator('a[href$="/edit"]')).toHaveCount(0);
});

test('another signed-in member cannot edit and owner failure can recover', async ({
  page,
}) => {
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      json: {
        ...profile,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      },
    }),
  );
  const otherOwner = '6a770da7-b065-41d7-9355-31836b104f21';
  let failOwner = true;
  await page.route(`**/api/v1/members/${otherOwner}`, (route) =>
    route.fulfill(
      failOwner
        ? { status: 503, json: {} }
        : { json: { ...profile, id: otherOwner } },
    ),
  );
  await page.route(`**/api/v1/listings/${id}`, (route) =>
    route.fulfill({ json: { ...item, ownerId: otherOwner } }),
  );
  await signInFixture(page);
  await page.goto(`/listings/${id}`);
  await expect(
    page.getByText('Owner profile could not be loaded.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: item.title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit item' })).toHaveCount(0);
  failOwner = false;
  await page.getByRole('button', { name: 'Retry owner profile' }).click();
  await expect(
    page.getByRole('link', { name: profile.displayName }),
  ).toBeVisible();
});
