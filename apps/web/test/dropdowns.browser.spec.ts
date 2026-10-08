import { expect, test } from '@playwright/test';
import { signInFixture } from './auth-fixture';

test('dropdowns are rounded with hover feedback and accessible keyboard selection', async ({
  page,
}) => {
  await signInFixture(page);
  await page.goto('/');

  const dropdown = page.getByLabel('Theme');
  const control = page.locator('.native-select').filter({ has: dropdown });

  expect(
    await dropdown.evaluate(
      (element) =>
        Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) >=
        element.getBoundingClientRect().height / 2,
    ),
  ).toBe(true);
  await dropdown.hover();
  await expect(control).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
  await page.keyboard.press('Tab');
  await dropdown.focus();
  await expect(dropdown).toHaveCSS('outline-width', '2px');
  await expect(dropdown).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect(dropdown).toHaveValue('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);

  await dropdown.evaluate((element) => {
    (element as HTMLSelectElement).disabled = true;
  });
  await dropdown.hover({ force: true });
  await expect(control).toHaveCSS('transform', 'none');
  await expect(dropdown).toHaveCSS('cursor', 'not-allowed');

  await dropdown.evaluate((element) => {
    (element as HTMLSelectElement).disabled = false;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dropdown.hover();
  await expect(control).toHaveCSS('transform', 'none');
  await expect(dropdown).toHaveCSS('transition-duration', '0s');
});

test('dropdown chevrons stay centered and inside controls in both themes and at mobile widths', async ({
  page,
}) => {
  await signInFixture(page);
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto('/browse');

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });

      for (const control of await page.locator('.native-select').all()) {
        const select = control.locator('select');
        const arrow = control.locator('.native-select-arrow');
        await expect(select).toHaveCSS('appearance', 'none');
        await expect(select).toHaveCSS('padding-right', '40px');
        await expect(arrow).toHaveCSS('pointer-events', 'none');
        const box = await select.boundingBox();
        const icon = await arrow.boundingBox();

        expect(box).not.toBeNull();
        expect(icon).not.toBeNull();

        if (!box || !icon) throw new Error('Dropdown or arrow is missing');

        expect(icon.x).toBeGreaterThan(box.x);
        expect(icon.x + icon.width).toBeLessThan(box.x + box.width - 10);
        expect(
          Math.abs(icon.y + icon.height / 2 - (box.y + box.height / 2)),
        ).toBeLessThan(1);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }

      await page.screenshot({
        path: `test-results/dropdowns-${theme}-${width}.png`,
      });
    }
  }
});
