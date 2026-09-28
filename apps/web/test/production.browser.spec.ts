import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

test('production is signed out and contains no profile fixture', async ({
  page,
}) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174');

  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Alex Example')).toHaveCount(0);

  await expect(
    page.getByRole('button', { name: 'Open development account preview' }),
  ).toHaveCount(0);

  for (const file of await readdir('dist/assets')) {
    expect(await readFile(`dist/assets/${file}`, 'utf8')).not.toMatch(
      /Alex Example|Development-only profile fixture|Synthetic profile for development previews|Open development account preview|Jamie Demo|Priya Demo|This is a sample conversation, not a real message.|Development homepage preview|Sample content|Development API status|Connecting to the API/,
    );
  }

  await expect(
    page.getByText('Items could not be loaded.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Development homepage preview')).toHaveCount(0);
  await expect(page.locator('.listing-card')).toHaveCount(0);

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);

    await page.screenshot({
      path: `test-results/production-${theme}.png`,
      fullPage: true,
    });
  }

  expect(errors).toEqual([]);
});
