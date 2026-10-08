import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInFixture } from './auth-fixture';

const ownerId = 'a8ded912-c170-4988-8750-9747558e8a87';
const listingId = 'a329028e-1971-4763-b371-1ac4587c640a';
const now = '2026-09-24T08:00:00.000Z';
const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' };
const image = readFileSync(
  fileURLToPath(new URL('../src/assets/backpack.jpg', import.meta.url)),
);

test('photo previews, retry, persisted order, removal and accessible layouts', async ({
  page,
}) => {
  // Audit settled colors rather than intermediate theme-transition frames.
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const photos: {
    id: string;
    listingId: string;
    position: number;
    width: number;
    height: number;
    bytes: number;
    url: string;
  }[] = [];
  let uploads = 0;

  await page.route(`**/api/v1/listings/${listingId}`, (route) =>
    route.fulfill({
      headers,
      json: {
        id: listingId,
        ownerId,
        title: 'Canvas bag',
        description: 'Strong bag',
        condition: 'good',
        availability: 'available',
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  await page.route(`**/api/v1/listings/${listingId}/photos**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type',
        },
      });
    if (request.method() === 'GET')
      return route.fulfill({ headers, json: photos });
    if (request.method() === 'POST') {
      uploads++;
      if (uploads === 2)
        return route.fulfill({
          status: 503,
          headers,
          json: {
            error: {
              code: 'PHOTO_STORAGE_UNAVAILABLE',
              message: 'Retry.',
              requestId: crypto.randomUUID(),
            },
          },
        });
      const photo = {
        id: crypto.randomUUID(),
        listingId,
        position: photos.length,
        width: 500,
        height: 375,
        bytes: image.length,
        url: 'http://127.0.0.1:4173/src/assets/backpack.jpg',
      };
      photos.push(photo);
      return route.fulfill({ status: 201, headers, json: photo });
    }
    if (request.method() === 'PUT' && url.pathname.endsWith('/order')) {
      const ids = (request.postDataJSON() as { ids: string[] }).ids;
      photos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      photos.forEach((photo, position) => {
        photo.position = position;
      });
      return route.fulfill({ headers, json: photos });
    }
    if (request.method() === 'DELETE') {
      const index = photos.findIndex((photo) =>
        url.pathname.endsWith(photo.id),
      );
      photos.splice(index, 1);
      return route.fulfill({ status: 204, headers });
    }
    return route.fulfill({ status: 404, headers });
  });

  await signInFixture(page);
  await page.goto(`/listings/${listingId}/edit`);
  await page.evaluate(() => {
    const tracked = window as Window & { revokedPreviews?: number };
    tracked.revokedPreviews = 0;
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      tracked.revokedPreviews!++;
      revoke(url);
    };
  });
  await expect(page.getByText('0 of 3 photos selected.')).toBeVisible();
  await page.getByLabel('Choose photos').setInputFiles([
    { name: 'first.jpg', mimeType: 'image/jpeg', buffer: image },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer: image },
  ]);
  await expect(page.getByText('2 of 3 photos selected.')).toBeVisible();
  await page.getByRole('button', { name: 'Upload selected photos' }).click();
  await expect(
    page.getByText('Upload stopped.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('2 of 3 photos selected.')).toBeVisible();
  await expect(page.getByText('second.jpg', { exact: false })).toBeVisible();
  expect(uploads).toBe(2);
  expect(
    await page.evaluate(
      () => (window as Window & { revokedPreviews?: number }).revokedPreviews,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Upload selected photos' }).click();
  await expect(page.getByText('2 of 3 photos selected.')).toBeVisible();
  await expect(page.getByText('second.jpg', { exact: false })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { revokedPreviews?: number }).revokedPreviews,
    ),
  ).toBe(2);
  const promotedId = photos[1]!.id;
  await page.getByRole('button', { name: 'Move earlier' }).last().click();
  await expect.poll(() => photos[0]?.id).toBe(promotedId);
  await page.reload();
  await expect(page.getByText('2 of 3 photos selected.')).toBeVisible();
  expect(photos[0]?.id).toBe(promotedId);
  await page.getByLabel('Choose photos').setInputFiles({
    name: 'third.jpg',
    mimeType: 'image/jpeg',
    buffer: image,
  });
  await page.getByRole('button', { name: 'Upload selected photos' }).click();
  await expect(page.getByText('3 of 3 photos selected.')).toBeVisible();
  await expect(page.getByLabel('Choose photos')).toBeDisabled();
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.getByText('2 of 3 photos selected.')).toBeVisible();

  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('*')]
          .filter(
            (element) => element.getBoundingClientRect().right > innerWidth + 1,
          )
          .map((element) => element.tagName + '.' + element.className)
          .slice(0, 8),
      }));
      expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(
        overflow.width,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
});
