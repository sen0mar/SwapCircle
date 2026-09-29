import { QueryClient } from '@tanstack/react-query';
import {
  createClient,
  type RealtimeChannel,
  type Session,
} from '@supabase/supabase-js';
import { http, HttpResponse, delay } from 'msw';
import { expect, test, vi } from 'vitest';
import { server } from './setup';
import { startInboxRealtime } from '../src/features/inbox/inbox-realtime';
import {
  mergeMessage,
  type HistoryData,
} from '../src/features/inbox/message-cache';

const alice = '10000000-0000-4000-8000-000000000001';
const thread = '20000000-0000-4000-8000-000000000001';
const date = '2026-09-28T10:00:00Z';
const message = (order: number) => ({
  id: `30000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
  conversation_id: thread,
  sender_id: alice,
  body: 'Same plain text',
  client_message_id: `40000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
  message_order: order,
  created_at: date,
});
const key = ['private', alice, 'thread', thread, 'history'];
const history = (orders: number[]): HistoryData => ({
  pages: [{ items: orders.map(message), nextCursor: 1 }],
  pageParams: [undefined],
});

function fixture(initial = true) {
  const client = createClient('http://127.0.0.1:55439', 'synthetic', {
    auth: { persistSession: false },
  });
  vi.spyOn(client.auth, 'getSession').mockResolvedValue({
    data: { session: { user: { id: alice } } as Session },
    error: null,
  });
  const listeners = new Map<string, (payload: { new: unknown }) => void>();
  let subscribed: (value: string) => void = () => {};
  const channel = {
    on: (
      _: string,
      filter: { table: string },
      callback: (payload: { new: unknown }) => void,
    ) => {
      listeners.set(filter.table, callback);
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
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initial) queries.setQueryData(key, history([1, 3]));
  const state = {
    allowed: true,
    orders: Array.from({ length: 67 }, (_, i) => i + 1),
    wait: 0,
  };
  const reads: URL[] = [];
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/conversations', () =>
      HttpResponse.json(
        state.allowed
          ? {
              id: thread,
              type: 'group',
              direct_user_low: null,
              direct_user_high: null,
              created_at: date,
            }
          : null,
      ),
    ),
    http.get('http://127.0.0.1:55439/rest/v1/messages', async ({ request }) => {
      const url = new URL(request.url);
      reads.push(url);
      const filter = url.searchParams.get('message_order');
      const rows = filter?.startsWith('gt.')
        ? state.orders.filter((order) => order > Number(filter.slice(3)))
        : [...state.orders].reverse();
      await delay(state.wait);
      return HttpResponse.json(
        rows.slice(0, Number(url.searchParams.get('limit'))).map(message),
      );
    }),
  );
  const scope = new AbortController();
  const status = vi.fn();
  const connection = startInboxRealtime({
    client,
    queries,
    userId: alice,
    id: thread,
    signal: scope.signal,
    status,
  });
  return {
    queries,
    state,
    reads,
    scope,
    status,
    connection,
    open,
    remove,
    subscribe: () => subscribed('SUBSCRIBED'),
    event: (value: unknown) => listeners.get('messages')?.({ new: value }),
    revoke: () => listeners.get('conversation_members')?.({ new: {} }),
  };
}

const orders = (queries: QueryClient) =>
  queries
    .getQueryData<HistoryData>(key)
    ?.pages.flatMap((page) => page.items)
    .map((row) => row.message_order)
    .sort((a, b) => a - b);

test('send responses and events deduplicate by identity in either order and retain old cursors', () => {
  for (const receipts of [
    [message(2), message(2)],
    [message(3), message(2), message(3)],
  ]) {
    const merged = receipts.reduce(mergeMessage, history([1, 3]));
    expect(merged.pages[0]?.items.map((row) => row.message_order)).toEqual([
      3, 2, 1,
    ]);
    expect(merged.pages[0]?.nextCursor).toBe(1);
  }
});

test('startup/reconnect repairs gaps before a higher receipt with ascending bounded pages', async () => {
  const f = fixture();
  try {
    f.subscribe();
    await vi.waitFor(() => expect(orders(f.queries)).toHaveLength(67));
    expect(f.reads.map((url) => url.searchParams.get('message_order'))).toEqual(
      ['gt.0', 'gt.30', 'gt.60'],
    );
    expect(
      f.reads.every(
        (url) =>
          url.searchParams.get('order') === 'message_order.asc' &&
          url.searchParams.get('limit') === '30',
      ),
    ).toBe(true);
    f.state.orders.push(68, 69);
    f.event(message(69));
    await vi.waitFor(() => expect(orders(f.queries)).toHaveLength(69));
    f.state.orders.push(70);
    f.subscribe();
    await vi.waitFor(() => expect(orders(f.queries)).toHaveLength(70));
    expect(f.open).toHaveBeenCalledTimes(1);
  } finally {
    f.connection.stop();
  }
});

test('an event racing initial history is retained and malformed rows are ignored', async () => {
  const f = fixture(false);
  f.state.wait = 30;
  try {
    f.subscribe();
    f.event(message(68));
    f.event({ body: 'invalid event' });
    await vi.waitFor(() => expect(orders(f.queries)).toContain(68));
    expect(orders(f.queries)?.filter((order) => order === 68)).toHaveLength(1);
  } finally {
    f.connection.stop();
  }
});

test('membership revocation purges history and profiles and refuses later events', async () => {
  const f = fixture();
  try {
    f.queries.setQueryData(
      ['private', alice, 'thread', thread, 'profiles'],
      'private profile',
    );
    f.state.allowed = false;
    f.revoke();
    await vi.waitFor(() => expect(orders(f.queries)).toEqual([]));
    expect(
      f.queries.getQueryData(['private', alice, 'thread', thread, 'profiles']),
    ).toBeUndefined();
    f.event(message(70));
    await vi.waitFor(() =>
      expect(
        f.queries.getQueryState(['private', alice, 'thread', thread, 'access'])
          ?.status,
      ).toBe('error'),
    );
    expect(orders(f.queries)).toEqual([]);
  } finally {
    f.connection.stop();
  }
});

test('navigation/account cancellation prevents late backfill and old events repopulating cleared caches', async () => {
  const f = fixture();
  f.state.wait = 100;
  f.subscribe();
  await vi.waitFor(() => expect(f.reads).toHaveLength(1));
  f.scope.abort();
  f.connection.stop();
  f.queries.clear();
  f.event(message(70));
  f.subscribe();
  await delay(150);
  expect(f.queries.getQueryCache().getAll()).toHaveLength(0);
  expect(f.remove).toHaveBeenCalledTimes(1);
});

test('failed recovery keeps durable history, reports failure and can be retried', async () => {
  const f = fixture();
  server.use(
    http.get(
      'http://127.0.0.1:55439/rest/v1/messages',
      () => HttpResponse.error(),
      { once: true },
    ),
  );
  try {
    f.subscribe();
    await vi.waitFor(() =>
      expect(f.status).toHaveBeenCalledWith(
        expect.stringContaining('could not be refreshed'),
      ),
    );
    expect(orders(f.queries)).toEqual([1, 3]);
    f.connection.retry();
    await vi.waitFor(() => expect(orders(f.queries)).toHaveLength(67));
    expect(f.status).toHaveBeenLastCalledWith(null);
  } finally {
    f.connection.stop();
  }
});

test('navigation alone cancels a pending recovery and removes the channel', async () => {
  const f = fixture();
  f.state.wait = 100;
  f.subscribe();
  await vi.waitFor(() => expect(f.reads).toHaveLength(1));
  f.connection.stop();
  f.queries.clear();
  f.event(message(70));
  await delay(150);
  expect(f.queries.getQueryCache().getAll()).toHaveLength(0);
  expect(f.remove).toHaveBeenCalledTimes(1);
});
