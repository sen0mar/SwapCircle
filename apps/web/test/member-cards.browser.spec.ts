import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['light', 'dark']) {
  test(`member card layout remains readable and accessible in ${theme}`, async ({
    page,
  }) => {
    const interests = [
      { id: 'd833e507-cffc-4ee0-8adc-d9aa539765ac', name: 'Photography' },
      { id: '9ba76ef2-f5aa-4bba-a614-9cb7cdf73430', name: 'Books' },
    ];

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/listings?*', (route) =>
      route.fulfill({ json: { items: [], nextCursor: null } }),
    );
    await page.route('**/api/v1/interests', (route) =>
      route.fulfill({ json: interests }),
    );
    await page.route('**/api/v1/members?*', (route) =>
      route.fulfill({
        json: {
          items: [
            'Jamie Parker',
            'Alex Chen',
            'Priya Shah',
            'A member with a longer display name',
          ].map((displayName, index) => ({
            id: `a8ded912-c170-4988-8750-9747558e8a8${index}`,
            displayName,
            biography: '',
            approximateLocation: index === 3 ? '' : 'Paris area',
            avatarUrl: null,
            interests: index === 1 ? [] : interests,
            sharedInterestCount: null,
            sharedInterests: [],
          })),
          nextCursor: null,
        },
      }),
    );
    await page.goto('/');
    await page.getByLabel('Theme').selectOption(theme);
    await expect(page.locator('.member-preview')).toHaveCount(4);
    await expect(page.getByText('Location not shared')).toBeVisible();

    for (const width of [360, 768, 1280, 1600, 800]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const card of await page.locator('.member-preview').all()) {
        await expect(
          card.getByRole('link', { name: 'View profile' }),
        ).toBeVisible();
        await expect(
          card.getByRole('link', { name: 'Sign in to message' }),
        ).toBeVisible();
        expect(
          await card.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/member-cards-${theme}-${width}.png`,
        fullPage: true,
      });
    }

    const profile = page
      .locator('.member-preview')
      .first()
      .getByRole('link', { name: 'View profile' });
    await profile.focus();
    await expect(profile).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page
        .locator('.member-preview')
        .first()
        .getByRole('link', { name: 'Sign in to message' }),
    ).toBeFocused();
  });
}
