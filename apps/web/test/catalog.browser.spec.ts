import { test, expect } from '@playwright/test';

const ownerId = 'a8ded912-c170-4988-8750-9747558e8a87';
const item = {
  id: '7911f95a-c9df-4831-b4bf-8203dbd6aad7',
  ownerId,
  title: 'A garden guide',
  description: 'A public description',
  condition: 'good',
  availability: 'available',
  revision: 1,
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
};

test('search is available only on Browse and absent from the shared header', async ({
  page,
}) => {
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Search items' })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await page.getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search items', exact: true }),
  ).toBeVisible();
  await expect(page.locator('header').getByText('Search items')).toHaveCount(0);
});

test('search URLs retain filters across pagination, reload and Back; filter submission resets the cursor', async ({
  page,
}) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/v1/listings?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    return route.fulfill({
      json: {
        items: [item],
        nextCursor: query.has('cursor') ? null : 'synthetic-cursor',
        previousCursor: query.has('cursor') ? 'page-start' : null,
      },
    });
  });
  await page.route('**/api/v1/listings/*/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({
      json: {
        id: ownerId,
        displayName: 'Local Member',
        biography: '',
        approximateLocation: 'Paris area',
        interests: [],
      },
    }),
  );
  await page.goto(
    '/browse?q=garden&condition=good&availability=available&sort=oldest',
  );
  await expect(
    page.getByRole('searchbox', { name: 'Search items', exact: true }),
  ).toHaveValue('garden');
  await expect(
    page.getByRole('combobox', { name: 'Condition', exact: true }),
  ).toHaveValue('good');
  await expect(
    page.getByRole('combobox', { name: 'Sort', exact: true }),
  ).toHaveValue('oldest');
  await page.getByRole('link', { name: 'Next' }).click();
  await expect(page).toHaveURL(
    /q=garden.*condition=good.*sort=oldest.*cursor=synthetic-cursor/,
  );
  await page.reload();
  await expect(
    page.getByRole('searchbox', { name: 'Search items', exact: true }),
  ).toHaveValue('garden');
  await page
    .getByRole('searchbox', { name: 'Search items', exact: true })
    .fill('books');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/q=books/);
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
  await page.goBack();
  await expect(
    page.getByRole('searchbox', { name: 'Search items', exact: true }),
  ).toHaveValue('garden');
  await expect(page.getByRole('link', { name: 'Previous' })).toBeVisible();
  expect(
    requests.every(
      (query) =>
        query.get('condition') === 'good' && query.get('sort') === 'oldest',
    ),
  ).toBe(true);
});

test('invalid shared catalog URLs explain recovery without making a misleading query', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/v1/listings?*', (route) => {
    calls++;
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/browse?sort=distance');
  await expect(page.getByRole('alert')).toContainText('filters are invalid');
  expect(calls).toBe(0);
  await page.getByRole('link', { name: 'Clear all' }).click();
  await expect(
    page.getByRole('heading', { name: 'No items to show yet' }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test('the entire listing card opens the item while the owner keeps a separate link', async ({
  page,
}) => {
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [item], nextCursor: null } }),
  );
  await page.route(`**/api/v1/listings/${item.id}`, (route) =>
    route.fulfill({ json: item }),
  );
  await page.route('**/api/v1/listings/*/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({
      json: {
        id: ownerId,
        displayName: 'Local Member',
        biography: '',
        approximateLocation: 'Paris area',
        interests: [],
      },
    }),
  );

  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of [
      '.photo-unavailable',
      '.listing-condition',
      '.listing-location',
    ]) {
      await page.goto('/browse');
      await expect(
        page.getByRole('link', { name: 'Local Member' }),
      ).toBeVisible();
      // Click coordinates exercise the stretched link above noninteractive content.
      await page.locator(`.listing-card ${target}`).scrollIntoViewIfNeeded();
      const bounds = await page
        .locator(`.listing-card ${target}`)
        .boundingBox();
      expect(bounds).not.toBeNull();
      await page.mouse.click(
        bounds!.x + bounds!.width / 2,
        bounds!.y + bounds!.height / 2,
      );
      await expect(page).toHaveURL(`/listings/${item.id}`);
    }
  }

  await page.goto('/browse');
  const title = page.getByRole('link', { name: item.title, exact: true });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/listings/${item.id}`);

  await page.goto('/browse');
  await page.getByRole('link', { name: 'Local Member' }).click();
  await expect(page).toHaveURL(`/members/${ownerId}`);
});

test('Previous page moves one page back after reload and retains filters', async ({
  page,
}) => {
  await page.route('**/api/v1/listings?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('q')).toBe('garden');
    expect(query.get('condition')).toBe('good');
    expect(query.get('sort')).toBe('oldest');
    const cursor = query.get('cursor');
    const previous = query.get('direction') === 'previous';
    const index =
      query.get('direction') === 'last'
        ? 2
        : previous
          ? Number(cursor) - 1
          : Number(cursor ?? 0);
    return route.fulfill({
      json: {
        items: [{ ...item, title: `Page ${index + 1} item` }],
        page: index + 1,
        totalPages: 3,
        nextCursor: index < 2 ? String(index + 1) : null,
        previousCursor: index > 0 ? String(index) : null,
      },
    });
  });
  await page.route('**/api/v1/listings/*/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({
      json: {
        id: ownerId,
        displayName: 'Local Member',
        biography: '',
        approximateLocation: 'Paris',
        interests: [],
      },
    }),
  );
  await page.goto('/browse?q=garden&condition=good&sort=oldest');
  const next = page.getByRole('link', { name: 'Next', exact: true });
  const previous = page.getByRole('link', {
    name: 'Previous',
    exact: true,
  });
  await expect(previous).toHaveCount(0);
  await next.click();
  await expect(
    page.getByRole('heading', { name: 'Page 2 item' }),
  ).toBeVisible();
  await next.click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Page 3 item' }),
  ).toBeVisible();
  await expect(next).toHaveCount(0);
  await previous.click();
  await expect(
    page.getByRole('heading', { name: 'Page 2 item' }),
  ).toBeVisible();
  await expect(page.getByText('Page 2 of 3', { exact: true })).toBeVisible();
  await expect(previous).toHaveClass(/ui-button-primary/);
  await expect(next).toHaveClass(/ui-button-primary/);
  await page.reload();
  await previous.click();
  await expect(
    page.getByRole('heading', { name: 'Page 1 item' }),
  ).toBeVisible();
  await expect(previous).toHaveCount(0);
  await page.getByRole('link', { name: 'Last page', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Page 3 item' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Last page', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await previous.click();
  await expect(
    page.getByRole('heading', { name: 'Page 2 item' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'First page', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Page 1 item' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'First page', exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 900 });
  await next.click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
