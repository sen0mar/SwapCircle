import { expect, test } from '@playwright/test';
import { signInFixture } from './auth-fixture';
import {
  expectReducedMotion,
  expectVisibleKeyboardFocus,
} from './ui-assertions';

test('account button works with pointer and keyboard and cannot activate when disabled', async ({
  page,
}) => {
  await signInFixture(page);
  await page.goto('/');

  const button = page.getByRole('button', { name: 'Open account' });
  const dialog = page.getByRole('dialog', { name: 'Account' });

  await button.hover();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.blur();
  await expectVisibleKeyboardFocus(button);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await button.evaluate((element) => {
    (element as HTMLButtonElement).disabled = true;
    (element as HTMLButtonElement).click();
  });
  await expect(button).toBeDisabled();
  await expect(dialog).toHaveCount(0);
});

test('account button respects reduced motion on hover and press', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInFixture(page);
  await page.goto('/');

  const button = page.getByRole('button', { name: 'Open account' });

  await button.hover();
  await expectReducedMotion(button);
  await page.mouse.down();
  await expectReducedMotion(button);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});
