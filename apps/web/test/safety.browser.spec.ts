import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { signInFixture } from './auth-fixture';

const actor = 'a8ded912-c170-4988-8750-9747558e8a87';
const other = 'b8ded912-c170-4988-8750-9747558e8a87';
const itemId = '7911f95a-c9df-4831-b4bf-8203dbd6aad7';
const profile = (id: string) => ({
  id,
  displayName: id === actor ? 'Local Alice' : 'Local Bob',
  biography: 'Public biography',
  approximateLocation: 'Paris area',
  interests: [],
});

test('keyboard safety actions reconcile block failures and preserve retry-safe private reports', async ({
  page,
}) => {
  let blocked = false;
  let attempts = 0;
  let releaseReport: (() => void) | undefined;
  const reports: Record<string, unknown>[] = [];
  await page.route('**/api/v1/members/*', (route) =>
    route.fulfill({
      json: profile(new URL(route.request().url()).pathname.split('/').at(-1)!),
    }),
  );
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/safety/status*', (route) =>
    route.fulfill({ json: { restricted: true, ownBlocked: blocked } }),
  );
  await page.route('**/api/v1/safety/blocks**', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: {
          items: blocked
            ? [
                {
                  userId: other,
                  displayName: 'Local Bob',
                  createdAt: '2026-09-01T12:00:00Z',
                },
              ]
            : [],
          nextAfter: null,
        },
      });
    blocked = route.request().method() === 'PUT';
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/safety/reports', async (route) => {
    reports.push(route.request().postDataJSON());
    attempts++;
    if (attempts === 1)
      await new Promise<void>((resolve) => {
        releaseReport = resolve;
      });
    return attempts === 1
      ? route.fulfill({
          status: 429,
          json: {
            error: {
              code: 'ACTION_LIMIT',
              message: 'PRIVATE_INTERNAL_REASON',
              requestId: actor,
            },
          },
        })
      : route.fulfill({
          status: 201,
          json: { id: itemId, createdAt: '2026-09-01T12:00:00Z' },
        });
  });
  await signInFixture(page);
  await page.goto(`/members/${other}`);
  const block = page.getByRole('button', { name: 'Block member', exact: true });
  await block.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(block).toBeFocused();
  await block.click();
  await page
    .getByRole('button', { name: 'Confirm block', exact: true })
    .click();
  await expect(
    page.getByText('You have blocked this member.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await page
    .getByLabel('Reason for reporting')
    .fill('Private synthetic concern <script>not markup</script>');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Sending report' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sending report…' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  releaseReport?.();
  await expect(page.getByRole('alert')).toContainText('reached the limit');
  await expect(page.getByLabel('Reason for reporting')).toBeDisabled();
  await expect(page.getByRole('dialog')).not.toContainText(
    'PRIVATE_INTERNAL_REASON',
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await expect(page.getByLabel('Reason for reporting')).toHaveValue(
    'Private synthetic concern <script>not markup</script>',
  );
  await page.getByRole('button', { name: 'Retry report' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Report received' }),
  ).toBeVisible();
  expect(reports[0]).toEqual(reports[1]);
  expect(reports[0]).toMatchObject({ targetType: 'member', targetId: other });
  await page.keyboard.press('Escape');
  await page.goto('/account/settings');
  await expect(
    page.getByRole('link', { name: 'Local Bob', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Changes and new contact', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Unblock member', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm unblock', exact: true })
    .click();
  await expect(page.getByText('No blocked members.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Blocked members', exact: true }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto(`/members/${actor}`);
  await expect(
    page.getByRole('button', { name: 'Report member', exact: true }),
  ).toHaveCount(0);
});

test('signed-out public member prompts sign-in without private safety reads', async ({
  page,
}) => {
  let privateReads = 0;
  await page.route('**/api/v1/safety/**', (route) => {
    privateReads++;
    return route.fulfill({ status: 401 });
  });
  await page.route('**/api/v1/members/*', (route) =>
    route.fulfill({ json: profile(other) }),
  );
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.goto(`/members/${other}`);
  await expect(
    page
      .getByRole('region', { name: 'Safety actions' })
      .getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Block member', exact: true }),
  ).toHaveCount(0);
  expect(privateReads).toBe(0);
});

test('account changes clear report drafts and private block cache for the same public target', async ({
  page,
}) => {
  await page.route('**/api/v1/members/*', (route) =>
    route.fulfill({ json: profile(itemId) }),
  );
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/safety/blocks**', (route) =>
    route.fulfill({ json: { items: [], nextAfter: null } }),
  );
  await page.route('**/api/v1/safety/status*', (route) => {
    const encoded =
      route.request().headers().authorization?.split('.')[1] ?? '';
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
      sub: string;
    };
    return route.fulfill({
      json: { restricted: false, ownBlocked: claims.sub === actor },
    });
  });
  await signInFixture(page);
  await page.goto(`/members/${itemId}`);
  await expect(
    page.getByRole('button', { name: 'Unblock member', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await page
    .getByLabel('Reason for reporting')
    .fill('A private draft belonging to the first account.');
  await page.keyboard.press('Escape');
  await page.goto('/account/settings');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  await signInFixture(page, '/account', other);
  await page.goto(`/members/${itemId}`);
  await expect(
    page.getByRole('button', { name: 'Block member', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Report member', exact: true })
    .click();
  await expect(page.getByLabel('Reason for reporting')).toHaveValue('');
});
