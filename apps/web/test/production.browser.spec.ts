import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

test('production is signed out and contains no profile fixture', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4174');
  await expect(
    page.getByRole('button', { name: 'Sign-in — not available yet' }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Alex Example')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open development account preview' }),
  ).toHaveCount(0);
  for (const file of await readdir('dist/assets')) {
    expect(await readFile(`dist/assets/${file}`, 'utf8')).not.toMatch(
      /Alex Example|Development-only profile fixture|Synthetic profile for development previews|Open development account preview/,
    );
  }
  expect(errors).toEqual([]);
});
