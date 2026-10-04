import { test, expect } from '@playwright/test';
import { signInFixture } from './auth-fixture';
import AxeBuilder from '@axe-core/playwright';

test('protected route preserves its query and fragment through a single OAuth code exchange', async ({
  page,
}) => {
  let exchanges = 0;
  const outdatedDependencies: string[] = [];
  const unoptimizedMonitoringModules: string[] = [];

  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;

    if (path === '/auth/v1/token') exchanges++;
    if (path.includes('/node_modules/.pnpm/@sentry+'))
      unoptimizedMonitoringModules.push(path);
  });

  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;

    if (response.status() === 504 && path.includes('/node_modules/.vite/deps/'))
      outdatedDependencies.push(path);
  });

  await signInFixture(page, '/account?view=session#details');

  await expect(page).toHaveURL(
    'http://127.0.0.1:4173/account?view=session#details',
  );

  expect(exchanges).toBe(1);
  expect(outdatedDependencies).toEqual([]);
  expect(unoptimizedMonitoringModules).toEqual([]);
});

test('SDK OAuth callback, reload, protected route and sign-out lifecycle (synthetic transport)', async ({
  page,
}) => {
  await signInFixture(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();

  await expect(
    page.getByText('Your session is verified.', { exact: false }),
  ).toBeVisible();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open account' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(
    page.getByRole('heading', { name: 'Sign in to SwapCircle' }),
  ).toBeVisible();

  await expect(page.getByRole('button', { name: 'Open account' })).toHaveCount(
    0,
  );

  await page.reload();

  await expect(
    page.getByRole('heading', { name: 'Sign in to SwapCircle' }),
  ).toBeVisible();
});

test('sign-in and failed callback are usable in both themes and all target widths', async ({
  page,
}) => {
  for (const theme of ['light', 'dark']) {
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/sign-in?next=https://evil.invalid');
      await page.getByLabel('Theme').selectOption(theme);

      const notice = page.getByRole('complementary', {
        name: 'Portfolio demo',
      });
      const disclosure = notice.locator('details');
      const summary = notice.locator('summary');

      await expect(notice).toBeVisible();
      await summary.focus();
      await summary.press('Enter');
      await expect(disclosure).toHaveAttribute('open', '');

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);

      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.screenshot({
        path: `test-results/auth-notice-open-${theme}-${width}.png`,
        fullPage: true,
      });

      await summary.press('Enter');
      await expect(disclosure).not.toHaveAttribute('open');
      await expect(summary).toBeFocused();

      await page.screenshot({
        path: `test-results/auth-${theme}-${width}.png`,
      });
    }
  }

  await page.goto(
    '/auth/callback?error=access_denied&error_description=private-secret',
  );

  await expect(page.getByRole('alert')).toContainText(
    'Sign-in could not be completed',
  );

  await expect(page.getByText('private-secret')).toHaveCount(0);
});

test('rejected identity offers a working reauthentication path', async ({
  page,
}) => {
  await signInFixture(page);

  await page.route('**/api/v1/identity', (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sign in to continue.',
          requestId: 'a8ded912-c170-4988-8750-9747558e8a87',
        },
      },
    }),
  );

  await page.reload();
  await expect(page.getByRole('alert')).toContainText('could not be verified');

  await page
    .getByRole('button', { name: 'Sign out and sign in again' })
    .click();

  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeEnabled();

  await expect(page.getByRole('button', { name: 'Open account' })).toHaveCount(
    0,
  );
});
