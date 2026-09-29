import { test, expect } from '@playwright/test';
import { signInFixture } from './auth-fixture';

const alice = 'a8ded912-c170-4988-8750-9747558e8a87';
const bob = 'b8ded912-c170-4988-8750-9747558e8a88';
const id = '20000000-0000-4000-8000-000000000001';
const denied = '20000000-0000-4000-8000-000000000002';
const conversation = {
  id,
  type: 'direct',
  direct_user_low: alice,
  direct_user_high: bob,
  created_at: '2026-09-28T10:00:00Z',
};
const profile = (userId: string, current = false) => ({
  id: userId,
  displayName: userId === alice ? 'Inbox Alice' : 'Inbox Bob',
  biography: '',
  approximateLocation: '',
  interests: [],
  avatarUrl: null,
  ...(current
    ? { createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:00Z' }
    : {}),
});

test('private deep link requires sign-in and returns to its stable URL; switching threads never shows old contents', async ({
  page,
}) => {
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({ json: profile(alice, true) }),
  );
  await page.route('**/api/v1/members/*', (route) =>
    route.fulfill({ json: profile(bob) }),
  );
  await page.route('**/api/v1/conversations/*/unread', (route) =>
    route.fulfill({ json: { lastViewedOrder: 0, unreadCount: 0 } }),
  );
  await page.route('**/api/v1/conversations/read', (route) =>
    route.fulfill({ json: { lastViewedOrder: 32, unreadCount: 0 } }),
  );
  await page.route('**/rest/v1/conversations?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('id') === `eq.${denied}`) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await route.fulfill({ json: null });
    } else
      await route.fulfill({
        json: url.searchParams.has('id')
          ? conversation
          : [conversation, { ...conversation, id: denied }],
      });
  });
  await page.route('**/rest/v1/messages?*', (route) =>
    route.fulfill({
      json: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          conversation_id: id,
          sender_id: bob,
          body: 'Private thread body',
          client_message_id: '40000000-0000-4000-8000-000000000001',
          message_order: 1,
          created_at: '2026-09-28T10:00:00Z',
        },
      ],
    }),
  );
  await signInFixture(page, `/inbox/${id}`);
  await expect(page).toHaveURL(new RegExp(`/inbox/${id}$`));
  await expect(
    page.getByRole('region', { name: 'Message history' }),
  ).toContainText('Private thread body');
  await page.getByLabel('Message draft').fill('Unsent draft');
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeEnabled();
  await page.locator(`.conversation-list a[href="/inbox/${denied}"]`).click();
  await expect(
    page.getByRole('region', { name: 'Message history' }),
  ).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('do not have access');
  await page.locator(`.conversation-list a[href="/inbox/${id}"]`).click();
  await expect(page.getByLabel('Message draft')).toHaveValue('Unsent draft');
  await page.reload();
  await expect(page.getByLabel('Message draft')).toHaveValue('');
  await page.getByRole('button', { name: 'Open account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  await expect(page.getByText('Private thread body')).toHaveCount(0);
});

test('Message starts an Express DM and reports contact denial without navigating to a fictional thread', async ({
  page,
}) => {
  await page.route('**/api/v1/profiles/me', (route) =>
    route.fulfill({ json: profile(alice, true) }),
  );
  await page.route('**/api/v1/members/*', (route) =>
    route.fulfill({ json: profile(bob) }),
  );
  await page.route('**/api/v1/listings?*', (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route('**/api/v1/safety/status?*', (route) =>
    route.fulfill({ json: { restricted: false, ownBlocked: false } }),
  );
  await page.route('**/api/v1/conversations/direct', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ userId: bob });
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'CONTACT_BLOCKED',
          message: 'Private internal details',
          requestId: '40000000-0000-4000-8000-000000000001',
        },
      },
    });
  });
  await signInFixture(page);
  await page.goto(`/members/${bob}`);
  await page.getByRole('button', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Contact with this member is unavailable',
  );
  await expect(page.getByText('Private internal details')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/members/${bob}$`));
});
