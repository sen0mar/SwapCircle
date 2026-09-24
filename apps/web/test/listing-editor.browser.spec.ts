import { test, expect } from '@playwright/test';
import type { Listing } from '@swapcircle/contracts';
import { signInFixture } from './auth-fixture';

const ownerId = 'a8ded912-c170-4988-8750-9747558e8a87';
const now = '2026-09-24T08:00:00.000Z';
const headers = { 'Access-Control-Allow-Origin': 'http://127.0.0.1:4173' };

test('create, edit, withdraw and reload with draft recovery', async ({
  page,
}) => {
  let item: Listing | undefined;
  let failSave = true;

  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({
      headers,
      json: {
        id: ownerId,
        displayName: 'Synthetic owner',
        biography: '',
        approximateLocation: '',
        interests: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  await page.route('**/api/v1/listings**', (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'authorization, content-type',
        },
      });

    if (request.method() === 'GET' && url.pathname.endsWith('/mine'))
      return route.fulfill({
        headers,
        json: { items: item ? [item] : [], nextCursor: null },
      });

    if (
      request.method() === 'GET' &&
      url.pathname.endsWith(item?.id ?? '/missing')
    )
      return route.fulfill({ headers, json: item });

    if (request.method() === 'POST' && url.pathname.endsWith('/withdraw')) {
      item = {
        ...item!,
        availability: 'withdrawn',
        revision: item!.revision + 1,
        updatedAt: now,
      };
      return route.fulfill({ headers, json: item });
    }

    if (request.method() === 'POST' || request.method() === 'PUT') {
      if (failSave) {
        failSave = false;
        return route.fulfill({
          status: 503,
          headers,
          json: {
            error: {
              code: 'TEMPORARY',
              message: 'Try again.',
              requestId: crypto.randomUUID(),
            },
          },
        });
      }

      const input = request.postDataJSON();
      item = {
        id: item?.id ?? 'a329028e-1971-4763-b371-1ac4587c640a',
        ownerId,
        title: input.title,
        description: input.description,
        condition: input.condition,
        availability: 'available',
        revision: (item?.revision ?? 0) + 1,
        createdAt: now,
        updatedAt: now,
      };
      return route.fulfill({
        status: request.method() === 'POST' ? 201 : 200,
        headers,
        json: item,
      });
    }

    return route.fulfill({ status: 404, headers });
  });
  await page.route(`**/api/v1/members/${ownerId}`, (route) =>
    route.fulfill({
      headers,
      json: {
        id: ownerId,
        displayName: 'Synthetic owner',
        biography: '',
        approximateLocation: '',
        interests: [],
      },
    }),
  );

  await signInFixture(page);
  await page.goto('/listings/new');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.getByLabel('Title').fill('Canvas bag');
  await page.getByLabel('Description').fill('Clean, sturdy and ready to use.');
  await page.getByLabel('Fair').check();
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(
    page.getByText('Your draft is still here', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Canvas bag');
  await page.getByRole('button', { name: 'Create item' }).click();
  await expect(page).toHaveURL(/\/listings\/a329028e[^/]*$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Canvas bag' })).toBeVisible();

  await page.goto('/shelf');
  await expect(page.getByText('Canvas bag')).toBeVisible();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Title').fill('Repaired canvas bag');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page).toHaveURL(/\/listings\/a329028e[^/]*$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Repaired canvas bag' }),
  ).toBeVisible();

  await page.goto('/shelf');
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Withdraw item?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep item' }).click();
  await expect(page.getByText('Fair · Available')).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(page.getByText('Withdrawn')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Withdrawn')).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
});
