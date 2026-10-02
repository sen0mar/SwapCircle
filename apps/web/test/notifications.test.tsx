import {
  createClient,
  type RealtimeChannel,
  type Session,
} from '@supabase/supabase-js';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { http, HttpResponse, delay } from 'msw';
import { expect, test, vi, afterEach } from 'vitest';
import type { NotificationRead } from '@swapcircle/contracts';
import { server } from './setup';
import { apiRequest } from '../src/lib/api-client';
import {
  markNotificationsRead,
  notificationsKey,
  readNotifications,
} from '../src/features/notifications/notifications-api';
import { startNotificationsRealtime } from '../src/features/notifications/notifications-realtime';
import { NotificationContent } from '../src/features/notifications/NotificationContent';
import { NotificationPage } from '../src/features/notifications/NotificationPage';
import { NotificationBell } from '../src/features/notifications/NotificationBell';

const state = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => state.auth,
}));
const user = '10000000-0000-4000-8000-000000000001';
const peer = '10000000-0000-4000-8000-000000000002';
const row = (n: number): NotificationRead => ({
  id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  recipient_id: user,
  domain_event_id: user,
  resource_id: user,
  resource_type: 'trade',
  event_type: 'trade_invitation',
  created_at: '2026-09-29T00:00:00Z',
  read_at: null,
});

function fixture() {
  const client = createClient('http://127.0.0.1:55439', 'synthetic', {
    auth: { persistSession: false },
  });
  vi.spyOn(client.auth, 'getSession').mockResolvedValue({
    data: { session: { user: { id: user } } as Session },
    error: null,
  });
  let subscribed: (value: string) => void = () => {};
  let event: () => void = () => {};
  const channel = {
    on: (_: string, _filter: unknown, callback: () => void) => {
      event = callback;
      return channel;
    },
    subscribe: (callback: (value: string) => void) => {
      subscribed = callback;
      return channel;
    },
  };
  const open = vi
    .spyOn(client, 'channel')
    .mockReturnValue(channel as unknown as RealtimeChannel);
  const remove = vi.spyOn(client, 'removeChannel').mockResolvedValue('ok');
  const scope = new AbortController();
  state.auth = {
    session: { user: { id: user } },
    client,
    readSignal: scope.signal,
    request: apiRequest,
  };
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rows = [row(1)];
  const reads: URL[] = [];
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/notifications', ({ request }) => {
      const url = new URL(request.url);
      reads.push(url);
      const cursor = url.searchParams.get('or')?.match(/id.lt.([^)]*)/)?.[1];
      return HttpResponse.json(
        [...rows]
          .reverse()
          .filter((item) => !cursor || item.id < cursor)
          .slice(0, 100),
      );
    }),
  );
  return {
    client,
    queries,
    rows,
    reads,
    scope,
    open,
    remove,
    event: () => event(),
    subscribed: (value = 'SUBSCRIBED') => subscribed(value),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('recipient-scoped creation cursors load every page and reject foreign rows', async () => {
  const f = fixture();
  f.rows.push(...Array.from({ length: 204 }, (_, i) => row(i + 2)));
  const items = await readNotifications(f.client, user, f.scope.signal);
  expect(items).toHaveLength(205);
  expect(f.reads).toHaveLength(3);
  expect(
    f.reads.every(
      (url) =>
        url.searchParams.get('recipient_id') === `eq.${user}` &&
        url.searchParams.get('limit') === '100',
    ),
  ).toBe(true);
  server.use(
    http.get('*/rest/v1/notifications', () =>
      HttpResponse.json([{ ...row(1), recipient_id: peer }]),
    ),
  );
  await expect(
    readNotifications(f.client, user, f.scope.signal),
  ).rejects.toThrow('unavailable');
});

test('mark-all copies distinct intended IDs before awaiting and batches at 100', async () => {
  const ids = Array.from({ length: 205 }, (_, i) => row(i + 1).id);
  ids.push(ids[0]!);
  const writes: string[][] = [];
  server.use(
    http.put('*/api/v1/notifications/read-all', async ({ request }) => {
      const body = (await request.json()) as { notification_ids: string[] };
      writes.push(body.notification_ids);
      ids.push(row(999).id);
      return HttpResponse.json({
        items: body.notification_ids.map((id) => ({
          id,
          read_at: '2026-09-29T01:00:00Z',
        })),
      });
    }),
  );
  await markNotificationsRead(
    apiRequest,
    ids,
    new AbortController().signal,
    true,
  );
  expect(writes.map((batch) => batch.length)).toEqual([100, 100, 5]);
  expect(new Set(writes.flat()).size).toBe(205);
  expect(writes.flat()).not.toContain(row(999).id);
});

test('a failed batch stops, retry keeps the original snapshot and cancellation stops further writes', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => row(i + 1).id);
  let fail = true;
  const writes: string[][] = [];
  const scope = new AbortController();
  server.use(
    http.put('*/api/v1/notifications/read-all', async ({ request }) => {
      const { notification_ids: batch } = (await request.json()) as {
        notification_ids: string[];
      };
      writes.push(batch);
      if (fail)
        return HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unavailable',
              requestId: user,
            },
          },
          { status: 500 },
        );
      return HttpResponse.json({ items: [] });
    }),
  );
  await expect(
    markNotificationsRead(apiRequest, ids, scope.signal, true),
  ).rejects.toThrow();
  expect(writes).toHaveLength(1);
  fail = false;
  await markNotificationsRead(apiRequest, ids, scope.signal, true);
  expect(writes.map((batch) => batch.length)).toEqual([100, 100, 1]);
  scope.abort();
  await expect(
    markNotificationsRead(apiRequest, ids, scope.signal, true),
  ).rejects.toThrow();
  expect(writes).toHaveLength(3);
});

test('one readiness-waiting channel reconciles startup, missed events and reconnects; identity abort removes it immediately', async () => {
  const f = fixture();
  const observer = new QueryObserver(f.queries, {
    queryKey: notificationsKey(user),
    queryFn: ({ signal }) => readNotifications(f.client, user, signal),
  });
  const unsubscribe = observer.subscribe(() => {});
  const status = vi.fn();
  const connection = startNotificationsRealtime({
    client: f.client,
    queries: f.queries,
    userId: user,
    signal: f.scope.signal,
    status,
  });
  try {
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toHaveLength(1),
    );
    f.rows.push(row(2));
    f.subscribed();
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toHaveLength(2),
    );
    f.rows.push(row(3));
    f.event();
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toHaveLength(3),
    );
    f.subscribed('CHANNEL_ERROR');
    expect(status).toHaveBeenLastCalledWith(
      expect.stringContaining('reconnecting'),
    );
    f.rows.push(row(4));
    f.subscribed();
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toHaveLength(4),
    );
    expect(f.open).toHaveBeenCalledExactlyOnceWith(`notifications:${user}`, {
      config: { postgres_changes_options: { wait: true } },
    });
    f.scope.abort();
    expect(f.remove).toHaveBeenCalledTimes(1);
    f.queries.clear();
    f.event();
    f.subscribed();
    await delay(30);
    expect(f.queries.getQueryCache().getAll()).toHaveLength(0);
  } finally {
    connection.stop();
    unsubscribe();
  }
});

test('in-flight startup events trigger another snapshot; unmount prevents late repopulation', async () => {
  const f = fixture();
  let release: (() => void) | undefined;
  let reads = 0;
  server.use(
    http.get('*/rest/v1/notifications', async () => {
      const snapshot = [...f.rows];
      reads++;
      if (reads === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return HttpResponse.json(snapshot);
    }),
  );
  const observer = new QueryObserver(f.queries, {
    queryKey: notificationsKey(user),
    queryFn: ({ signal }) => readNotifications(f.client, user, signal),
  });
  const unsubscribe = observer.subscribe(() => {});
  const connection = startNotificationsRealtime({
    client: f.client,
    queries: f.queries,
    userId: user,
    signal: f.scope.signal,
    status: () => {},
  });
  await vi.waitFor(() => expect(reads).toBe(1));
  f.rows.push(row(2));
  f.event();
  release?.();
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().data).toHaveLength(2),
  );
  connection.stop();
  unsubscribe();
  f.queries.clear();
  f.event();
  f.subscribed();
  await delay(30);
  expect(f.queries.getQueryCache().getAll()).toHaveLength(0);
});

test('panel mounting never writes, failed reads/counts remain explicit and retryable, empty state is truthful', async () => {
  const f = fixture();
  server.use(
    http.get('*/rest/v1/notifications', () => HttpResponse.error(), {
      once: true,
    }),
  );
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open notifications, count unavailable',
    }),
  );
  await screen.findByRole('button', { name: 'Retry notifications' });
  f.rows.length = 0;
  fireEvent.click(screen.getByRole('button', { name: 'Retry notifications' }));
  await screen.findByText(/No notifications yet/);
  expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('loading does not imply zero unread; token refresh keeps one channel and unmount cleans it up', async () => {
  const f = fixture();
  server.use(
    http.get('*/rest/v1/notifications', async () => {
      await delay(40);
      return HttpResponse.json(f.rows);
    }),
  );
  const tree = () => (
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open notifications, count unavailable',
    }),
  );
  expect(screen.getByText('Loading notifications…')).toBeVisible();
  await screen.findByText('1 unread notifications');
  state.auth = {
    ...state.auth,
    session: { user: { id: user }, access_token: 'refreshed-synthetic' },
  };
  view.rerender(tree());
  expect(f.open).toHaveBeenCalledTimes(1);
  f.subscribed();
  await waitFor(() =>
    expect(screen.queryByText('Connecting live notifications…')).toBeNull(),
  );
  view.unmount();
  expect(f.remove).toHaveBeenCalledTimes(1);
  f.event();
  f.subscribed();
  await delay(50);
  expect(f.queries.getQueryCache().getAll()).toHaveLength(0);
});

test('a stale or changed SDK session denies reads instead of exposing cached private records', async () => {
  const f = fixture();
  vi.mocked(f.client.auth.getSession).mockResolvedValue({
    data: { session: { user: { id: peer } } as Session },
    error: null,
  });
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open notifications, count unavailable',
    }),
  );
  await screen.findByRole('button', { name: 'Retry notifications' });
  expect(f.reads).toHaveLength(0);
  expect(screen.queryByRole('link', { name: 'View notification' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
});

test('a partially saved mark-all retries the same bounded set after a later batch fails', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => row(i + 1).id);
  const writes: string[][] = [];
  let fail = true;
  server.use(
    http.put('*/api/v1/notifications/read-all', async ({ request }) => {
      const { notification_ids: batch } = (await request.json()) as {
        notification_ids: string[];
      };
      writes.push(batch);
      if (batch.length === 1 && fail)
        return HttpResponse.json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unavailable',
              requestId: user,
            },
          },
          { status: 500 },
        );
      return HttpResponse.json({ items: [] });
    }),
  );
  const signal = new AbortController().signal;
  await expect(
    markNotificationsRead(apiRequest, ids, signal, true),
  ).rejects.toThrow();
  fail = false;
  await markNotificationsRead(apiRequest, ids, signal, true);
  expect(writes.map((batch) => batch.length)).toEqual([100, 1, 100, 1]);
  expect(writes.slice(0, 2).flat()).toEqual(writes.slice(2).flat());
});

test('persisted read reconciliation clears single/all retry warnings after a lost response', async () => {
  for (const all of [false, true]) {
    const f = fixture();
    server.use(
      http.put(`*/api/v1/notifications/${all ? 'read-all' : 'read'}`, () => {
        f.rows[0]!.read_at = '2026-09-29T01:00:00Z';
        return HttpResponse.error();
      }),
    );
    const view = render(
      <QueryClientProvider client={f.queries}>
        <MemoryRouter>
          <NotificationBell />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Open notifications, 1 unread' });
    fireEvent.click(
      screen.getByRole('button', { name: 'Open notifications, 1 unread' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: all ? 'Mark all read' : 'Mark read' }),
    );
    await screen.findByText('0 unread notifications');
    expect(screen.getByText('Read', { exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Retry mark/ })).toBeNull();
    view.unmount();
  }
});

test('coffee notification resolves its swap only through an authorized backend read', async () => {
  const f = fixture();
  const trade = '30000000-0000-4000-8000-000000000001';
  const item = {
    ...row(1),
    resource_type: 'coffee_invitation' as const,
    event_type: 'coffee_invitation' as const,
  };
  server.use(
    http.get(`*/api/v1/coffee/${item.resource_id}`, () =>
      HttpResponse.json({
        id: item.resource_id,
        tradeId: trade,
        inviterId: peer,
        inviteeId: user,
        offerToPay: false,
        status: 'pending',
        createdAt: '2026-10-02T08:00:00.000Z',
        respondedAt: null,
      }),
    ),
  );
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationContent item={item} detail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole('link', { name: 'View coffee in swap' }),
  ).toHaveAttribute('href', `/swaps/${trade}#coffee`);
});

test('unavailable coffee notification exposes retry without linking to a guessed swap', async () => {
  const f = fixture();
  const item = {
    ...row(1),
    resource_type: 'coffee_invitation' as const,
    event_type: 'coffee_response' as const,
  };
  server.use(
    http.get(
      `*/api/v1/coffee/${item.resource_id}`,
      () => new HttpResponse(null, { status: 404 }),
    ),
  );
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationContent item={item} detail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Retry coffee invitation' });
  expect(
    screen.queryByRole('link', { name: 'View coffee in swap' }),
  ).toBeNull();
});

test('meeting notification page resolves an authorized link without deferred copy or exact details; previews never look up details', async () => {
  const f = fixture();
  const item = {
    ...row(1),
    event_type: 'meeting_change' as const,
    resource_type: 'meetup' as const,
  };
  f.rows.splice(0, f.rows.length, item);
  let lookups = 0;
  const place = 'Synthetic private library entrance';
  const meetingAt = '2026-10-25T01:30:00.123Z';
  server.use(
    http.get('*/api/v1/meetups/:id', () => {
      lookups++;
      return HttpResponse.json({
        id: user,
        tradeId: peer,
        tradeVersion: 1,
        revision: 2,
        place,
        mapLink: null,
        meetingAt,
        timeZone: 'Europe/Paris',
        responses: [{ userId: user, response: null }],
      });
    }),
  );
  const view = render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter initialEntries={[`/notifications/${item.id}`]}>
        <Routes>
          <Route path="/notifications/:id" element={<NotificationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const link = await screen.findByRole('link', {
    name: 'View meeting in swap',
  });
  expect(link).toHaveAttribute('href', `/swaps/${peer}#meeting`);
  expect(screen.queryByText(/related feature is not available yet/)).toBeNull();
  expect(screen.queryByText(place)).toBeNull();
  expect(screen.queryByText(/Europe\/Paris/)).toBeNull();
  expect(screen.queryByText(meetingAt)).toBeNull();
  expect(lookups).toBe(1);
  view.unmount();
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter>
        <NotificationContent item={item} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('link', { name: 'View notification' }),
  ).toHaveAttribute('href', `/notifications/${item.id}`);
  expect(screen.queryByText(place)).toBeNull();
  expect(screen.queryByText(/Europe\/Paris/)).toBeNull();
  expect(screen.queryByText(meetingAt)).toBeNull();
  expect(lookups).toBe(1);
});

test('unavailable meetup notification shows a generic retry without a swap link or deferred copy', async () => {
  const f = fixture();
  const item = {
    ...row(1),
    event_type: 'meeting_change' as const,
    resource_type: 'meetup' as const,
  };
  f.rows.splice(0, f.rows.length, item);
  server.use(
    http.get(
      '*/api/v1/meetups/:id',
      () => new HttpResponse(null, { status: 404 }),
    ),
  );
  render(
    <QueryClientProvider client={f.queries}>
      <MemoryRouter initialEntries={[`/notifications/${item.id}`]}>
        <Routes>
          <Route path="/notifications/:id" element={<NotificationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Retry meeting link' });
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This meeting could not be loaded or is unavailable to this account.',
  );
  expect(
    screen.queryByRole('link', { name: 'View meeting in swap' }),
  ).toBeNull();
  expect(screen.queryByText(/related feature is not available yet/)).toBeNull();
});
