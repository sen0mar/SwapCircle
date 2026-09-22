import { expect, type Page } from '@playwright/test';

export async function signInFixture(
  page: Page,
  destination = '/account',
  id = 'a8ded912-c170-4988-8750-9747558e8a87',
) {
  const now = Math.floor(Date.now() / 1000);

  const token =
    [
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: id,
        exp: now + 3600,
        iat: now,
        aud: 'authenticated',
        role: 'authenticated',
      },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.') + '.synthetic';

  await page.route('http://127.0.0.1:55439/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith('/authorize')) {
      const callback = new URL(url.searchParams.get('redirect_to')!);

      callback.searchParams.set('code', 'synthetic-test-code');

      await route.fulfill({
        status: 302,
        headers: { location: callback.href },
      });
    } else if (url.pathname.endsWith('/token')) {
      await route.fulfill({
        json: {
          access_token: token,
          refresh_token: 'synthetic-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id,
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: { provider: 'google' },
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        },
      });
    } else await route.fulfill({ status: 204 });
  });

  await page.route('**/api/v1/identity', (route) =>
    route.fulfill({ json: { userId: id } }),
  );

  await page.goto(destination);
  await page.getByRole('button', { name: 'Continue with Google' }).click();

  await expect(
    page.getByText('Your session is verified.', { exact: false }),
  ).toBeVisible();
}
