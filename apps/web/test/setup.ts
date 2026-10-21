import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const server = setupServer(
  http.get('*/api/v1/conversations/messages/:id/proposal', ({ params }) =>
    HttpResponse.json({
      messageId: params.id,
      conversationId: '20000000-0000-4000-8000-000000000001',
      recipientId: '10000000-0000-4000-8000-000000000001',
      status: 'pending',
      respondedAt: null,
    }),
  ),
  http.get('*/api/v1/conversations/proposals/accepted', () =>
    HttpResponse.json({ items: [], nextCursor: null }),
  ),
  http.get('*/api/v1/conversations/:id/unread', () =>
    HttpResponse.json({ lastViewedOrder: 0, unreadCount: 0 }),
  ),
);

// jsdom has no layout; viewport acknowledgement is covered by its focused harness and real browser journeys.
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
