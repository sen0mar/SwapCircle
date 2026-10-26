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

test('simple proposals keep drafts and retry selected shelf items with accessible layouts', async ({
  page,
}) => {
  await setup(page);
  let previousPayload: unknown;
  let attempts = 0;
  await page.route('**/api/v1/conversations/proposals', async (route) => {
    const payload = route.request().postDataJSON();
    attempts++;
    if (previousPayload) expect(payload).toEqual(previousPayload);
    previousPayload = payload;
    expect(payload.offeredListingId).toBe(ids.lamp);
    expect(payload.body).toBe('Would you swap for my lamp?');
    expect(payload.photoBase64).toBeUndefined();
    return route.fulfill({ status: 503 });
  });
  await page.getByRole('button', { name: 'Propose a trade' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Choose from my shelf' }).check();
  await dialog.getByRole('radio', { name: /Desk lamp/ }).check();
  await dialog
    .getByLabel('Message', { exact: true })
    .fill('Would you swap for my lamp?');
  await expect(
    dialog.getByRole('button', { name: 'Review proposal' }),
  ).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Propose a trade' }),
    ).toBeFocused();
    await page.getByLabel('Theme').selectOption(theme);
    await page.getByRole('button', { name: 'Propose a trade' }).click();
    await expect(
      dialog.getByRole('radio', { name: /Desk lamp/ }),
    ).toBeChecked();
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
          .violations,
      ).toEqual([]);
      await page.screenshot({
        path: `test-results/simple-proposal-${theme}-${width}.png`,
      });
    }
  }
  await dialog.getByRole('button', { name: 'Send proposal' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Send proposal' }).click();
  await expect.poll(() => attempts).toBe(2);
});
