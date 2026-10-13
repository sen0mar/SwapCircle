import { expect, test } from '@playwright/test';
import { signInFixture } from './auth-fixture';
import {
  expectReducedMotion,
  expectVisibleKeyboardFocus,
} from './ui-assertions';

test('theme dropdown supports keyboard selection, visible focus and reduced motion', async ({
  page,
}) => {
  await signInFixture(page);
  await page.goto('/');

  const dropdown = page.getByLabel('Theme');
  const control = page.locator('.native-select').filter({ has: dropdown });

  await dropdown.hover();
  await expectVisibleKeyboardFocus(dropdown);
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect(dropdown).toHaveValue('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);

  await dropdown.evaluate((element) => {
    (element as HTMLSelectElement).disabled = true;
  });
  await expect(dropdown).toBeDisabled();
  await page.keyboard.press('l');
  await page.keyboard.press('Enter');
  await expect(dropdown).toHaveValue('dark');

  await dropdown.evaluate((element) => {
    (element as HTMLSelectElement).disabled = false;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dropdown.hover();
  await expectReducedMotion(control);
  await expectReducedMotion(dropdown);
});

test('dropdown chevrons stay centered and inside controls in both themes and at mobile widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
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
        await expect(arrow).toHaveCSS('pointer-events', 'none');
        const box = await select.boundingBox();
        const icon = await arrow.boundingBox();

        expect(box).not.toBeNull();
        expect(icon).not.toBeNull();

        if (!box || !icon) throw new Error('Dropdown or arrow is missing');

        const paddingRight = await select.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).paddingRight),
        );
        const arrowInset = box.x + box.width - icon.x;

        expect(paddingRight).toBeGreaterThanOrEqual(arrowInset + 2);
        expect(icon.x).toBeGreaterThan(box.x);
        expect(icon.x + icon.width).toBeLessThan(box.x + box.width);
        expect(
          Math.abs(icon.y + icon.height / 2 - (box.y + box.height / 2)),
        ).toBeLessThanOrEqual(Math.max(2, box.height * 0.1));
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }

      await page.screenshot({
        path: `test-results/dropdowns-${theme}-${width}.png`,
      });
    }
  }
});
