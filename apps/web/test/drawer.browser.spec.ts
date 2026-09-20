import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const theme of ['light', 'dark']) {
  test(`drawer keyboard, dismissal, layout and accessibility in ${theme}`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByLabel('Theme').selectOption(theme);
    const trigger = page.getByRole('button', {
      name: 'Open development account preview',
    });
    const dialog = page.getByRole('dialog', { name: 'Account' });
    await expect(dialog).toHaveCount(0);
    const main = await page.locator('main').boundingBox();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Close', exact: true }),
    ).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    expect(await page.locator('main').boundingBox()).toEqual(main);
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByLabel('Theme')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Close', exact: true }),
    ).toBeFocused();
    await dialog
      .getByLabel('Theme')
      .selectOption(theme === 'light' ? 'dark' : 'light');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
    await expect(page.getByLabel('Theme')).toHaveValue(
      theme === 'light' ? 'dark' : 'light',
    );
    await trigger.click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.locator('.ui-overlay').click({ position: { x: 10, y: 200 } });
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.reload();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await trigger.click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const box = await dialog.boundingBox();
      expect(box?.width).toBe(Math.min(400, width));
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/drawer-${theme}-${width}.png`,
      });
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 640, height: 450 });
    await trigger.click();
    await dialog.getByLabel('Theme').focus();
    await expect(dialog.getByLabel('Theme')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}
