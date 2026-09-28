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
  await page.getByRole('link', { name: 'Next page' }).click();
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
  await expect(page.getByRole('link', { name: 'First page' })).toBeVisible();
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
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('heading', { name: 'No items to show yet' }),
  ).toBeVisible();
  expect(calls).toBe(1);
});
