import { expect, test } from '@playwright/test';
import { signInFixture } from './auth-fixture';

test('buttons are round and respond to hover and press while respecting reduced motion', async ({
  page,
}) => {
  await signInFixture(page);
  await page.goto('/');

  const button = page.getByRole('button', { name: 'Open account' });

  expect(
    await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const halfHeight = element.getBoundingClientRect().height / 2;

      return [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomLeftRadius,
        style.borderBottomRightRadius,
      ].every((radius) => Number.parseFloat(radius) >= halfHeight);
    }),
  ).toBe(true);
  await button.hover();
  await expect(button).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -2)');
  await page.mouse.down();
  await expect(button).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 1)');
  await page.mouse.move(0, 0);
  await page.mouse.up();

  await button.evaluate((element) => {
    (element as HTMLButtonElement).disabled = true;
  });
  await button.hover({ force: true });
  await expect(button).toHaveCSS('transform', 'none');

  await button.evaluate((element) => {
    (element as HTMLButtonElement).disabled = false;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.hover();
  await expect(button).toHaveCSS('transform', 'none');
  await expect(button).toHaveCSS('transition-duration', '0s');
  await page.mouse.down();
  await expect(button).toHaveCSS('transform', 'none');
  await page.mouse.move(0, 0);
  await page.mouse.up();

  await page.keyboard.press('Tab');
  await button.focus();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await expect(button).toHaveCSS('outline-width', '2px');
});
