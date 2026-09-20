import { test, expect } from '@playwright/test';

test('Home, theme, navigation and development drawer smoke', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Less stuff. More connection.' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveClass('dark');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Browse', exact: true })
    .click();
  await expect(page).toHaveURL(/\/browse$/);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Home', exact: true })
    .click();
  await expect(page.getByLabel('Theme')).toHaveValue('dark');
  const account = page.getByRole('button', {
    name: 'Open development account preview',
  });
  await account.click();
  await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(account).toBeFocused();
});
