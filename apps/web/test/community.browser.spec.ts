import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInFixture } from './auth-fixture';

const interest = {
  id: 'd833e507-cffc-4ee0-8adc-d9aa539765ac',
  name: 'Photography',
};
const member = {
  id: '7911f95a-c9df-4831-b4bf-8203dbd6aad7',
  displayName: 'Community Member',
  biography: '',
  approximateLocation: 'Paris area',
  avatarUrl: null,
  interests: [interest],
  sharedInterestCount: null,
  sharedInterests: [],
};

for (const theme of ['light', 'dark']) {
  test(`community navigation, pagination and responsive accessibility in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/interests', (route) =>
      route.fulfill({ json: [interest] }),
    );
    await page.route('**/api/v1/listings?*', (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.route('**/api/v1/members?*', (route) => {
      const query = new URL(route.request().url()).searchParams;
      return route.fulfill({
        json: {
          items: [
            {
              ...member,
              displayName: query.has('cursor')
                ? 'Next Member'
                : member.displayName,
            },
          ],
          nextCursor: query.has('cursor') ? null : 'synthetic-cursor',
        },
      });
    });
    await page.goto('/');
    await page.getByLabel('Theme').selectOption(theme);
    await page.getByRole('link', { name: 'View all members' }).click();
    await expect(
      page.getByRole('region', { name: 'Community', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: member.displayName }),
    ).toBeVisible();
    await page.getByLabel('Search by interest').selectOption(interest.id);
    await page.getByRole('link', { name: 'Next page' }).click();
    await expect(page).toHaveURL(
      new RegExp(`interest=${interest.id}.*cursor=synthetic-cursor`),
    );
    await expect(
      page.getByRole('heading', { name: 'Next Member' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Search by interest')).toHaveValue(
      interest.id,
    );
    await page.getByLabel('Search by interest').selectOption('');
    await expect(page).toHaveURL('/community');
    await page.goBack();
    await expect(page.getByLabel('Search by interest')).toHaveValue(
      interest.id,
    );
    await page.getByRole('link', { name: 'First page' }).click();
    await expect(page).toHaveURL(new RegExp(`interest=${interest.id}$`));

    for (const width of [360, 768, 1280, 1600, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/community-${theme}-${width}.png`,
        fullPage: true,
      });
    }
    const profile = page.getByRole('link', { name: 'View profile' });
    await profile.focus();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Sign in to message' }),
    ).toBeFocused();
    await page.getByRole('link', { name: 'Sign in to message' }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/sign-in\\?next=${encodeURIComponent(`/community?interest=${interest.id}`)}`,
      ),
    );
  });
}

test('community recovers from errors, handles empty and invalid filters, and uses personalized discovery', async ({
  page,
}) => {
  await page.route('**/api/v1/interests', (route) =>
    route.fulfill({ json: [interest] }),
  );
  let fail = true;
  let empty = false;
  await page.route('**/api/v1/members?*', (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'UNAVAILABLE',
              message: 'Try again.',
              requestId: 'test',
            },
          },
        })
      : route.fulfill({
          json: { items: empty ? [] : [member], nextCursor: null },
        }),
  );
  await page.goto('/community');
  await expect(page.getByRole('alert')).toContainText(
    'Members could not be loaded',
  );
  fail = false;
  await page.getByRole('button', { name: 'Retry members' }).click();
  await expect(
    page.getByRole('heading', { name: member.displayName }),
  ).toBeVisible();
  empty = true;
  await page.getByLabel('Search by interest').selectOption(interest.id);
  await expect(
    page.getByRole('heading', { name: 'No members to show yet' }),
  ).toBeVisible();
  await page.goto('/community?interest=invalid');
  await expect(page.getByRole('alert')).toContainText('filters are invalid');
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL('/community');

  await page.route('**/api/v1/members/discovery?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('limit')).toBe('20');
    return route.fulfill({
      json: {
        items: [
          { ...member, sharedInterestCount: 1, sharedInterests: [interest] },
        ],
        nextCursor: null,
      },
    });
  });
  await signInFixture(page);
  await page.goto('/community');
  await expect(
    page.getByText('1 shared interest', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Message', exact: true }),
  ).toBeVisible();
});

test('name search combines with interests, persists across pagination and history, and resets the cursor', async ({
  page,
}) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/v1/interests', (route) =>
    route.fulfill({ json: [interest] }),
  );
  await page.route('**/api/v1/members?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    return route.fulfill({
      json: {
        items: query.get('q') === 'missing' ? [] : [member],
        nextCursor: query.has('cursor') ? null : 'search-cursor',
      },
    });
  });
  await page.goto(`/community?interest=${interest.id}`);
  await page
    .getByRole('searchbox', { name: 'Search by name' })
    .fill('  Community  ');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`interest=${interest.id}&q=Community$`),
  );
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(new RegExp('q=Community&cursor=search-cursor$'));
  await expect.poll(() => requests.at(-1)?.get('cursor')).toBe('search-cursor');
  expect(requests.at(-1)?.get('q')).toBe('Community');
  expect(requests.at(-1)?.get('interest')).toBe(interest.id);
  await page.reload();
  await expect(
    page.getByRole('searchbox', { name: 'Search by name' }),
  ).toHaveValue('Community');
  await page.getByLabel('Search by interest').selectOption('');
  await expect(page).toHaveURL('/community?q=Community');
  await page.goBack();
  await expect(page.getByLabel('Search by interest')).toHaveValue(interest.id);
  await expect(
    page.getByRole('searchbox', { name: 'Search by name' }),
  ).toHaveValue('Community');
  await page.getByRole('searchbox', { name: 'Search by name' }).fill('missing');
  await page.getByRole('searchbox', { name: 'Search by name' }).press('Enter');
  await expect(page).toHaveURL(
    new RegExp(`interest=${interest.id}&q=missing$`),
  );
  await expect(
    page.getByRole('heading', { name: 'No members to show yet' }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Clear filters', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL('/community');
  await expect(
    page.getByRole('searchbox', { name: 'Search by name' }),
  ).toHaveValue('');
});
