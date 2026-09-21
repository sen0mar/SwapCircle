import { test, expect } from '@playwright/test';
import { signInFixture } from './auth-fixture';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['light', 'dark']) {
  test(`homepage composition, states and accessibility in ${theme}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await signInFixture(page);
    await page.goto('/');
    await page.getByLabel('Theme').selectOption(theme);
    await expect(page.getByText('Jamie Demo')).toHaveCount(0);
    await page.getByLabel('Development homepage preview').selectOption('ready');
    await expect(page.locator('.listing-card')).toHaveCount(4);
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.listing-photo').last().waitFor();
      expect(
        await page
          .locator('img')
          .evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement &&
                image.complete &&
                image.naturalWidth > 0,
            ),
          ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const photo of await page.locator('.listing-photo').all()) {
        await expect(photo).toHaveCSS('filter', 'none');
        await expect(photo).toHaveCSS('opacity', '1');
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/home-${theme}-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Open account' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `test-results/home-drawer-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const state of ['empty', 'loading', 'unavailable']) {
      await page.getByLabel('Development homepage preview').selectOption(state);
      await expect(page.locator('.listing-card')).toHaveCount(0);
      for (const width of [360, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.screenshot({
          path: `test-results/home-${state}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    }
    await page.getByLabel('Development homepage preview').selectOption('ready');
    // A 1600px display at 200% browser zoom has an 800 CSS-pixel layout viewport.
    await page.setViewportSize({ width: 800, height: 500 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/home-zoom-${theme}.png`,
      fullPage: true,
    });

    await page.getByRole('link', { name: 'Browse items' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Browse', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('unavailable photos retain useful layout and labels', async ({ page }) => {
  await page.route('**/backpack.jpg', (route) => route.abort());
  await page.goto('/');
  await page.getByLabel('Development homepage preview').selectOption('ready');
  await expect(page.getByText('Photo unavailable')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Everyday backpack' }),
  ).toBeVisible();
});
