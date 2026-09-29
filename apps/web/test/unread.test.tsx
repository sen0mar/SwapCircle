import { useRef } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { expect, test, vi, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './setup';
import { apiRequest } from '../src/lib/api-client';
import { useVisibleRead } from '../src/features/inbox/useVisibleRead';
import type { MessageRead } from '@swapcircle/contracts';
const user = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const signal = new AbortController().signal;
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: user } },
    request: apiRequest,
    readSignal: signal,
  }),
}));
const message = (order: number): MessageRead => ({
  id: `30000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
  conversation_id: id,
  sender_id: user,
  body: 'Synthetic',
  client_message_id: id,
  created_at: '2026-09-29T00:00:00Z',
  message_order: order,
});
let visible = true;
let lowerOnly = false;
let observe: (() => void) | undefined;
function Harness({ orders = [1, 2] }: { orders?: number[] }) {
  const root = useRef<HTMLDivElement>(null);
  const read = useVisibleRead(id, root, orders.map(message), true);
  return (
    <>
      <div ref={root} data-testid="viewport">
        {orders.map((order) => (
          <div
            key={order}
            data-message-id={message(order).id}
            data-message-order={order}
          >
            Message {order}
          </div>
        ))}
      </div>
      {read.error && <button onClick={read.retry}>Retry progress</button>}
    </>
  );
}
function fixture() {
  visible = true;
  lowerOnly = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: () => void) {
        observe = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const offscreen = lowerOnly && this.dataset.messageOrder === '2';
      return {
        top: offscreen ? 1200 : 10,
        bottom: offscreen ? 1300 : 100,
        left: 0,
        right: 200,
        width: 200,
        height: 90,
        x: 0,
        y: 10,
        toJSON: () => ({}),
      };
    },
  );
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    visible ? 'visible' : 'hidden',
  );
  const writes: string[] = [];
  let fail = false;
  server.use(
    http.put('*/api/v1/conversations/read', async ({ request }) => {
      const body = (await request.json()) as { message_id: string };
      writes.push(body.message_id);
      return fail
        ? HttpResponse.json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Unavailable',
                requestId: id,
              },
            },
            { status: 500 },
          )
        : HttpResponse.json({
            lastViewedOrder: Number(body.message_id.slice(-12)),
            unreadCount: 0,
          });
    }),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    writes,
    setFail: (value: boolean) => {
      fail = value;
    },
    queries,
    render: () =>
      render(
        <QueryClientProvider client={queries}>
          <Harness />
        </QueryClientProvider>,
      ),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('only visible rendered bubbles advance, and newly offscreen messages wait for scrolling', async () => {
  const f = fixture();
  lowerOnly = true;
  f.render();
  await waitFor(() => expect(f.writes).toEqual([message(1).id]));
  lowerOnly = false;
  fireEvent.scroll(screen.getByTestId('viewport'));
  await waitFor(() => expect(f.writes).toEqual([message(1).id, message(2).id]));
  fireEvent.scroll(screen.getByTestId('viewport'));
  expect(f.writes).toHaveLength(2);
});

test('a hidden tab never acknowledges; becoming visible saves its displayed position', async () => {
  const f = fixture();
  visible = false;
  f.render();
  observe?.();
  expect(f.writes).toHaveLength(0);
  visible = true;
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(f.writes).toEqual([message(2).id]));
});

test('failed read progress remains retryable without pretending the badge cleared', async () => {
  const f = fixture();
  f.setFail(true);
  f.render();
  await screen.findByRole('button', { name: 'Retry progress' });
  f.setFail(false);
  fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
  await waitFor(() => expect(f.writes).toHaveLength(2));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Retry progress' })).toBeNull(),
  );
});

test('unmount cancels observation before a pending frame can acknowledge', () => {
  const f = fixture();
  const result = f.render();
  result.unmount();
  observe?.();
  expect(f.writes).toHaveLength(0);
});

test('a modal-hidden thread cannot advance its private position', async () => {
  const f = fixture();
  visible = false;
  f.render();
  const viewport = screen.getByTestId('viewport');
  viewport.setAttribute('aria-hidden', 'true');
  visible = true;
  fireEvent(document, new Event('visibilitychange'));
  expect(f.writes).toHaveLength(0);
  viewport.removeAttribute('aria-hidden');
  await waitFor(() => expect(f.writes).toEqual([message(2).id]));
});

test('a burst of visible positions produces one write at the highest displayed position', async () => {
  const f = fixture();
  lowerOnly = true;
  f.render();
  observe?.();
  lowerOnly = false;
  observe?.();
  observe?.();
  await waitFor(() => expect(f.writes).toEqual([message(2).id]));
});
