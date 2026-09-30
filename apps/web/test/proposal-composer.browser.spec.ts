import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInFixture } from './auth-fixture';

const ids = {
  self: 'a8ded912-c170-4988-8750-9747558e8a87',
  owner: 'b8ded912-c170-4988-8750-9747558e8a87',
  third: 'c8ded912-c170-4988-8750-9747558e8a87',
  fourth: 'd8ded912-c170-4988-8750-9747558e8a87',
  bicycle: 'a329028e-1971-4763-b371-1ac4587c640a',
  lamp: 'b329028e-1971-4763-b371-1ac4587c640a',
  books: 'c329028e-1971-4763-b371-1ac4587c640a',
  plant: 'd329028e-1971-4763-b371-1ac4587c640a',
  bag: 'e329028e-1971-4763-b371-1ac4587c640a',
};
const timestamp = '2026-09-24T08:00:00.000Z';
const items = [
  [ids.bicycle, ids.owner, 'Bicycle'],
  [ids.lamp, ids.self, 'Desk lamp'],
  [ids.books, ids.third, 'Books'],
  [ids.plant, ids.fourth, 'Plant'],
  [ids.bag, ids.self, 'Canvas bag'],
].map(([id, ownerId, title]) => ({
  id,
  ownerId,
  title,
  description: 'A useful item',
  condition: 'good',
  availability: 'available',
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
}));
const profile = (id: string, displayName: string) => ({
  id,
  displayName,
  biography: '',
  approximateLocation: 'Paris area',
  interests: [],
  avatarUrl: null,
});

async function setup(page: import('@playwright/test').Page) {
  let writes = 0;
  await page.route('**/api/v1/listings/:id/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/listings/mine?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/listings?*', (route) => {
    const owner = new URL(route.request().url()).searchParams.get('owner');
    return route.fulfill({
      json: {
        items: items.filter((item) => item.ownerId === owner),
        nextCursor: null,
      },
    });
  });
  await page.route('**/api/v1/listings/*/photos', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/listings/*', (route) => {
    const id = route.request().url().split('/').pop();
    const item = items.find((candidate) => candidate.id === id);
    return route.fulfill(item ? { json: item } : { status: 404 });
  });
  await page.route(`**/api/v1/members/${ids.owner}`, (route) =>
    route.fulfill({ json: profile(ids.owner, 'Alex') }),
  );
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      json: {
        ...profile(ids.self, 'Morgan'),
        avatarCleanupPending: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    }),
  );
  await page.route('**/api/v1/members?*', (route) =>
    route.fulfill({
      json: {
        items: [profile(ids.third, 'Casey'), profile(ids.fourth, 'Drew')].map(
          (member) => ({
            ...member,
            sharedInterests: [],
            sharedInterestCount: null,
          }),
        ),
        nextCursor: null,
      },
    }),
  );
  await page.route('**/api/v1/trades', (route) => {
    writes++;
    return route.fulfill({ status: 500 });
  });
  await signInFixture(page);
  await page.goto(`/listings/${ids.bicycle}`);
  await expect(
    page.getByRole('button', { name: 'Propose a trade' }),
  ).toBeVisible();
  return () => writes;
}

test('mobile direct and group proposals preserve readable terms before sending', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Propose a trade' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Desk lamp' }).check();
  await page.getByRole('button', { name: 'Review proposal' }).click();
  await expect(
    page.getByRole('list', { name: 'Trade transfers' }).getByRole('listitem'),
  ).toHaveCount(2);
  await page.screenshot({ path: 'test-results/proposal-direct-mobile.png' });
  await page.getByRole('button', { name: 'Edit draft' }).click();
  const add = page.getByRole('combobox', { name: 'Add a person' });
  await add.selectOption(ids.third);
  await add.selectOption(ids.fourth);
  await page.getByRole('checkbox', { name: 'Canvas bag' }).check();
  await page.getByRole('checkbox', { name: 'Books' }).check();
  await page.getByRole('checkbox', { name: 'Plant' }).check();
  await page
    .getByRole('combobox', { name: 'Alex gives Bicycle to' })
    .selectOption(ids.third);
  await page
    .getByRole('combobox', { name: 'Casey gives Books to' })
    .selectOption(ids.fourth);
  await page.screenshot({
    path: 'test-results/proposal-group-edit-mobile.png',
  });
  await page
    .getByRole('button', { name: 'Review proposal' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: 'test-results/proposal-group-edit-mobile-bottom.png',
  });
  await page.getByRole('button', { name: 'Review proposal' }).click();
  await expect(
    page.getByRole('list', { name: 'Trade transfers' }).getByRole('listitem'),
  ).toHaveCount(5);
  await expect(page.getByText('4 people')).toBeVisible();
  for (const width of [360, 768, 800, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width === 360 || width === 1280)
      await page.screenshot({
        path: `test-results/proposal-group-${width}.png`,
      });
  }
  await page.getByRole('button', { name: 'Edit draft' }).click();
  await page.getByRole('button', { name: 'Keep draft and close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Theme').selectOption('dark');
  await page.setViewportSize({ width: 360, height: 900 });
  await page.getByRole('button', { name: 'Propose a trade' }).click();
  await page.getByRole('button', { name: 'Review proposal' }).click();
  await expect(
    page.getByRole('list', { name: 'Trade transfers' }).getByRole('listitem'),
  ).toHaveCount(5);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: 'test-results/proposal-group-dark-mobile.png',
  });
  expect(writes()).toBe(0);
});
