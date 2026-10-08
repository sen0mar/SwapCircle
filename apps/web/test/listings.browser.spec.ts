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

test('stored listing photos render on cards and detail with fallback', async ({
  page,
}) => {
  let url = 'http://127.0.0.1:4173/src/assets/backpack.jpg';
  const photo = {
    id: crypto.randomUUID(),
    listingId: id,
    position: 0,
    width: 500,
    height: 375,
    bytes: 1000,
  };
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [item], nextCursor: null } }),
  );
  await page.route(`**/api/v1/listings/${id}`, (route) =>
    route.fulfill({ json: item }),
  );
  await page.route(`**/api/v1/listings/${id}/photos`, (route) =>
    route.fulfill({ json: [{ ...photo, url }] }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({ json: profile }),
  );
  await page.goto('/browse');
  await expect(
    page.getByRole('img', { name: `${item.title}, photo 1` }),
  ).toBeVisible();
  await page.getByRole('link', { name: item.title }).click();
  await expect(
    page.getByRole('img', { name: `${item.title}, photo 1` }),
  ).toBeVisible();
  url = 'http://127.0.0.1:4173/broken-photo.jpg';
  await page.route('**/broken-photo.jpg', (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.reload();
  await expect(page.getByText('Photo unavailable')).toBeVisible();
});

test('public cursor navigation, reload, owner profile, long text and accessible themes', async ({
  page,
}) => {
  // Audit settled colors rather than intermediate theme-transition frames.
  await page.emulateMedia({ reducedMotion: 'reduce' });

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
    page.getByRole('link', { name: 'Sign in to message', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Sign in to preview a trade' }),
  ).toBeVisible();
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

test('only owners see the edit link', async ({ page }) => {
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
  await expect(page.getByRole('link', { name: 'Edit item' })).toHaveAttribute(
    'href',
    `/listings/${id}/edit`,
  );
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

test('listing cards show condition dots without availability labels in both themes', async ({
  page,
}) => {
  const variants = [
    { condition: 'like_new', label: 'Like new', token: '--state-success' },
    { condition: 'good', label: 'Good', token: '--state-success' },
    { condition: 'fair', label: 'Fair', token: '--state-warning' },
    { condition: 'poor', label: 'Poor', token: '--state-error' },
  ];
  const items = variants.map((variant, index) => ({
    ...item,
    id: crypto.randomUUID(),
    title: `Condition example ${index + 1}`,
    condition: variant.condition,
  }));

  await signInFixture(page);
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );
  await page.route('**/api/v1/listings/*/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({
      json: { ...profile, approximateLocation: 'Paris · 11th arrondissement' },
    }),
  );
  await page.route('**/api/v1/listings/mine?*', (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );

  for (const path of ['/browse', '/shelf']) {
    await page.goto(path);

    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme').selectOption(theme);
      const cards = page.locator('.listing-card, .shelf-item');
      await expect(cards).toHaveCount(4);

      for (const [index, variant] of variants.entries()) {
        const card = cards.nth(index);
        await expect(card.locator('.listing-condition')).toHaveText(
          variant.label,
        );
        await expect(card).not.toContainText(
          /available|reserved|exchanged|withdrawn|disputed/i,
        );
        const dot = card.locator('.listing-condition-dot');
        await expect(dot).toBeVisible();
        await expect(dot).toHaveAttribute('aria-hidden', 'true');
        await expect(dot).toHaveCSS('width', '12px');
        await expect(dot).toHaveCSS('height', '12px');
        await expect(dot).not.toHaveCSS('box-shadow', 'none');
        await expect(dot).toHaveCSS('background-image', /radial-gradient/);
        expect(
          await dot.evaluate((element, token) => {
            const expected = document.createElement('span');
            expected.style.backgroundColor = `var(${token})`;
            document.body.append(expected);
            const color = getComputedStyle(expected).backgroundColor;
            expected.remove();

            return getComputedStyle(element).backgroundColor === color;
          }, variant.token),
        ).toBe(true);
      }

      if (path === '/browse') {
        const firstCard = cards.first();
        const owner = firstCard.locator('.listing-owner');
        const location = firstCard.locator('.listing-location');
        await expect(owner).toContainText(profile.displayName);
        await expect(
          location.locator('.listing-location-label > span').first(),
        ).toHaveText('Paris');
        await expect(location.locator('.listing-location-district')).toHaveText(
          '11th arrondissement',
        );
        const pinBox = await location.locator('svg').boundingBox();
        const labelBox = await location
          .locator('.listing-location-label')
          .boundingBox();

        if (!pinBox || !labelBox)
          throw new Error('Location pin or label is missing');

        expect(labelBox.x - (pinBox.x + pinBox.width)).toBeCloseTo(6, 0);
        const ownerBox = await owner.boundingBox();
        const locationBox = await location.boundingBox();

        if (!ownerBox || !locationBox)
          throw new Error('Card metadata is missing');

        expect(locationBox.x).toBeGreaterThan(ownerBox.x);
        expect(
          Math.abs(
            locationBox.y +
              locationBox.height / 2 -
              (ownerBox.y + ownerBox.height / 2),
          ),
        ).toBeLessThan(2);
        await page.setViewportSize({ width: 360, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(owner).toBeVisible();
        await expect(location).toBeVisible();
        await page.screenshot({
          path: `test-results/cards-browse-${theme}-mobile.png`,
          fullPage: true,
        });
        await page.setViewportSize({ width: 1280, height: 900 });
      }

      await page.screenshot({
        path: `test-results/cards-${path.slice(1)}-${theme}.png`,
        fullPage: true,
      });
    }
  }
});
