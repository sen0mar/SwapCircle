import AxeBuilder from '@axe-core/playwright';
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
  await page.route('**/api/v1/conversations/messages', (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.conversation_id).toBe(id);
    expect(payload.body).toBe('A reply from the demo');

    return route.fulfill({
      json: {
        ...payload,
        id: '30000000-0000-4000-8000-000000000002',
        sender_id: alice,
        message_order: 2,
        created_at: '2026-09-28T10:01:00Z',
      },
    });
  });
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
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('.inbox-thread').scrollIntoViewIfNeeded();
    await expect(page.getByLabel('Message draft')).toBeInViewport();
    await expect(
      page.getByRole('button', { name: 'Send', exact: true }),
    ).toBeInViewport();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const threadBox = (await page.locator('.inbox-thread').boundingBox())!;
  const listBox = (await page.locator('.inbox-list').boundingBox())!;
  expect(Math.abs(threadBox.height - listBox.height)).toBeLessThan(2);
  expect(Math.abs(threadBox.y + threadBox.height - (800 - 24))).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    800,
  );
  await expect(
    page.getByRole('link', { name: 'Back to conversations' }),
  ).toBeHidden();
  const draftInput = page.getByLabel('Message draft');
  const singleLineHeight = (await draftInput.boundingBox())!.height;
  const sendBox = (await page
    .getByRole('button', { name: 'Send', exact: true })
    .boundingBox())!;
  const inputBox = (await draftInput.boundingBox())!;
  expect(singleLineHeight).toBe(44);
  expect(sendBox.height).toBe(singleLineHeight);
  expect(sendBox.y).toBe(inputBox.y);
  await draftInput.fill('First line\nSecond line\nThird line');
  await expect
    .poll(async () => (await draftInput.boundingBox())!.height)
    .toBeGreaterThan(singleLineHeight);
  await draftInput.fill('A reply from the demo');
  await expect
    .poll(async () => (await draftInput.boundingBox())!.height)
    .toBe(singleLineHeight);
  await page.getByLabel('Message draft').fill('A reply from the demo');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message draft')).toHaveValue('');
  await expect(
    page.getByRole('region', { name: 'Message history' }),
  ).toContainText('A reply from the demo');
  await page.getByLabel('Message draft').fill('Unsent draft');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
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

test('received and sent proposals appear as complete cards in both themes and narrow layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const full = {
    id: '30000000-0000-4000-8000-000000000011',
    conversation_id: id,
    sender_id: bob,
    body: 'Compatibility text',
    client_message_id: '40000000-0000-4000-8000-000000000011',
    message_order: 11,
    created_at: '2026-09-28T10:00:00Z',
    has_photo: true,
    proposal: {
      listingId: denied,
      listingTitle: 'Compact desktop keyboard',
      message:
        'Would you swap for my desk lamp?\nIt works well and comes with its original shade.',
      condition: 'good',
    },
  };
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
    route.fulfill({ json: { lastViewedOrder: 13, unreadCount: 0 } }),
  );
  await page.route('**/rest/v1/conversations?*', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has('id')
        ? conversation
        : [conversation],
    }),
  );
  await page.route('**/rest/v1/messages?*', (route) =>
    route.fulfill({
      json: [
        full,
        {
          ...full,
          id: '30000000-0000-4000-8000-000000000012',
          client_message_id: '40000000-0000-4000-8000-000000000012',
          message_order: 12,
          has_photo: false,
          proposal: {
            listingId: denied,
            listingTitle: 'Compact desktop keyboard',
            message: 'I could also offer a book.',
          },
        },
        {
          ...full,
          id: '30000000-0000-4000-8000-000000000013',
          client_message_id: '40000000-0000-4000-8000-000000000013',
          message_order: 13,
          sender_id: alice,
          has_photo: false,
          proposal: {
            ...full.proposal,
            message: 'Here is my offer in return.',
            condition: 'fair',
          },
        },
      ],
    }),
  );
  const decisions: Record<string, 'pending' | 'accepted' | 'refused'> = {};
  const responseState = (messageId: string) => ({
    messageId,
    conversationId: id,
    recipientId: messageId.endsWith('13') ? bob : alice,
    status: decisions[messageId] ?? 'pending',
    respondedAt: decisions[messageId] ? '2026-09-28T10:02:00Z' : null,
  });
  await page.route(
    '**/api/v1/conversations/messages/*/proposal',
    async (route) => {
      const messageId = new URL(route.request().url()).pathname
        .split('/')
        .at(-2)!;
      if (route.request().method() === 'PUT') {
        const { action } = route.request().postDataJSON();
        decisions[messageId] = action === 'accept' ? 'accepted' : 'refused';
      }
      return route.fulfill({ json: responseState(messageId) });
    },
  );
  await page.route('**/api/v1/trades?*', (route) =>
    route.fulfill({ json: { items: [], nextAfter: null } }),
  );
  await page.route('**/api/v1/conversations/proposals/accepted?*', (route) =>
    route.fulfill({
      json: {
        items:
          decisions[full.id] === 'accepted'
            ? [
                {
                  message: full,
                  response: responseState(full.id),
                  senderName: 'Inbox Bob',
                  recipientName: 'Inbox Alice',
                },
              ]
            : [],
        nextCursor: null,
      },
    }),
  );
  let photoAttempts = 0;
  await page.route('**/api/v1/conversations/messages/*/photo', (route) => {
    photoAttempts++;
    return photoAttempts === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          json: {
            dataUrl:
              'data:image/webp;base64,UklGRhYBAABXRUJQVlA4IAoBAACwHACdASqQASwBPm02mUmkIqKhICgAgA2JaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D1gAP7/2gX/Ox6Vv0HxXwAAAAAAAAAAAAAAAAAAAA==',
          },
        });
  });
  await signInFixture(page, `/inbox/${id}`);
  const cards = page.getByRole('article', { name: 'Trade proposal' });
  await expect(cards).toHaveCount(3);
  const incoming = cards.filter({
    hasText: 'Would you swap for my desk lamp?',
  });
  await expect(incoming.getByText('Good', { exact: true })).toBeVisible();
  await expect(incoming.getByRole('alert')).toHaveText(
    'Photo could not be loaded.',
  );
  await incoming.getByRole('button', { name: 'Retry photo' }).click();
  await expect(incoming.getByRole('img')).toBeVisible();
  await expect(incoming.getByRole('link')).toHaveAttribute(
    'href',
    `/listings/${denied}`,
  );
  await expect(
    cards
      .filter({ hasText: 'I could also offer a book.' })
      .getByText('Offered item quality'),
  ).toHaveCount(0);
  await expect(page.locator('.message-own').getByRole('article')).toHaveCount(
    1,
  );
  await expect(
    page
      .locator('.message-own')
      .getByRole('button', { name: 'Accept proposal' }),
  ).toHaveCount(0);
  await page.reload();
  await expect(cards).toHaveCount(3);
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Theme').selectOption(theme);
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await incoming.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `test-results/proposal-card-${theme}-${width}.png`,
      });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await incoming.scrollIntoViewIfNeeded();
  await incoming.getByRole('link').focus();
  await expect(incoming.getByRole('link')).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%';
  });
  const refused = cards.filter({ hasText: 'I could also offer a book.' });
  await refused.getByRole('button', { name: 'Refuse proposal' }).click();
  await expect(refused.getByText('Refused', { exact: true })).toBeVisible();
  await expect(
    refused.getByRole('button', { name: 'Accept proposal' }),
  ).toHaveCount(0);
  await incoming.getByRole('button', { name: 'Accept proposal' }).click();
  await expect(incoming.getByText('Accepted', { exact: true })).toBeVisible();
  await incoming.getByRole('link', { name: 'View in My Swaps' }).click();
  await expect(page.getByRole('tab', { name: 'Upcoming swaps' })).toBeVisible();
  await expect(cards).toHaveCount(0);
  await expect(
    page
      .getByRole('tabpanel', { name: 'Upcoming swaps' })
      .getByText('Compact desktop keyboard', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('tabpanel', { name: 'Upcoming swaps' })
      .getByRole('link', {
        name: 'Open swap conversation: Compact desktop keyboard',
      }),
  ).toHaveAttribute('href', `/inbox/${id}`);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Upcoming swaps' })).toBeVisible();
  await expect(cards).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
