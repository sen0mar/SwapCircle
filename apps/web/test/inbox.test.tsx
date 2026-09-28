import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { createClient, type Session } from '@supabase/supabase-js';
import { http, HttpResponse, delay } from 'msw';
import { server } from './setup';
import { apiRequest } from '../src/lib/api-client';
import { MessageComposerProvider } from '../src/features/inbox/MessageComposerProvider';
import { InboxPage } from '../src/features/inbox/InboxPage';
import { authorizeRead } from '../src/features/inbox/inbox-api';
import { safeDestination } from '../src/features/auth/safe-destination';

const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const thread = '20000000-0000-4000-8000-000000000001';
const empty = '20000000-0000-4000-8000-000000000002';
const denied = '20000000-0000-4000-8000-000000000003';
const client = createClient('http://127.0.0.1:55439', 'synthetic', {
  auth: { persistSession: false },
});
vi.spyOn(client.auth, 'getSession').mockResolvedValue({
  data: { session: { user: { id: alice } } as Session },
  error: null,
});
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: alice } },
    client,
    request: apiRequest,
    readSignal: new AbortController().signal,
  }),
}));
const date = '2026-09-28T10:00:00+00:00';
const conversation = (id: string) => ({
  id,
  type: 'direct',
  direct_user_low: alice,
  direct_user_high: bob,
  created_at: date,
});
const message = (order: number) => ({
  id: `30000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
  conversation_id: thread,
  sender_id: bob,
  body: order === 32 ? '<script>plain text</script>' : `Message ${order}`,
  client_message_id: `40000000-0000-4000-8000-${String(order).padStart(12, '0')}`,
  message_order: order,
  created_at: date,
});

function fixture() {
  const requests: URL[] = [];
  server.use(
    http.get(
      'http://127.0.0.1:55439/rest/v1/conversations',
      async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('id') === `eq.${denied}`)
          return HttpResponse.json(null);
        if (url.searchParams.get('id') === `eq.${empty}`) {
          await delay(80);
          return HttpResponse.json(conversation(empty));
        }
        return HttpResponse.json(
          url.searchParams.has('id')
            ? conversation(thread)
            : [conversation(thread), conversation(empty)],
        );
      },
    ),
    http.get('http://127.0.0.1:55439/rest/v1/messages', ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const before = Number(
        url.searchParams.get('message_order')?.slice(3) ?? 33,
      );
      const limit = Number(url.searchParams.get('limit'));
      const rows =
        url.searchParams.get('conversation_id') === `eq.${empty}`
          ? []
          : Array.from({ length: 32 }, (_, i) => message(32 - i))
              .filter((row) => row.message_order < before)
              .slice(0, limit);
      return HttpResponse.json(rows);
    }),
    http.get('http://127.0.0.1:3001/api/v1/members/:id', ({ params }) =>
      HttpResponse.json({
        id: params.id,
        displayName: 'Reader Bob',
        biography: '',
        approximateLocation: '',
        avatarUrl: null,
        interests: [],
      }),
    ),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <MessageComposerProvider>
        <MemoryRouter initialEntries={[`/inbox/${thread}`]}>
          <Link to={`/inbox/${denied}`}>Denied fixture</Link>
          <Routes>
            <Route path="/inbox/:id" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </MessageComposerProvider>
    </QueryClientProvider>,
  );

  return { requests, queries };
}

test('history pages render chronologically as plain text, use exclusive bounded cursors, and retain unsent per-thread drafts', async () => {
  const { requests } = fixture();
  const user = userEvent.setup();
  await screen.findByText('<script>plain text</script>', { selector: 'p' });
  const history = screen.getByRole('region', { name: 'Message history' });
  expect(history.querySelector('script')).toBeNull();
  expect(
    [...history.querySelectorAll('[data-message-order]')].map((li) =>
      Number(li.getAttribute('data-message-order')),
    ),
  ).toEqual(Array.from({ length: 30 }, (_, i) => i + 3));
  await user.click(screen.getByRole('button', { name: 'Load older messages' }));
  await screen.findByText('Message 1');
  expect(
    requests.some(
      (url) =>
        url.searchParams.get('limit') === '31' &&
        url.searchParams.get('message_order') === 'lt.3',
    ),
  ).toBe(true);
  await user.type(screen.getByLabelText('Message draft'), 'Still unsent');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*No messages yet/ }),
  );
  expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
  await screen.findByText('No messages yet.', { exact: true });
  expect(screen.getByLabelText('Message draft')).toHaveValue('');
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*plain text/ }),
  );
  await screen.findByText('<script>plain text</script>', { selector: 'p' });
  expect(screen.getByLabelText('Message draft')).toHaveValue('Still unsent');
});

test('denied thread hides history and composer rather than displaying empty or previous contents', async () => {
  fixture();
  await screen.findByText('<script>plain text</script>', { selector: 'p' });
  await userEvent.click(screen.getByRole('link', { name: 'Denied fixture' }));
  await screen.findByText(
    'This conversation cannot be found or you do not have access.',
  );
  expect(
    screen.queryByRole('region', { name: 'Message history' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Message draft')).not.toBeInTheDocument();
});

test('reads reject identity changes and cancelled lifetimes; sign-in can return to stable inbox URLs', async () => {
  await expect(
    authorizeRead(client, bob, new AbortController().signal),
  ).rejects.toThrow('Session unavailable');
  const scope = new AbortController();
  scope.abort();
  await expect(authorizeRead(client, alice, scope.signal)).rejects.toThrow();
  expect(safeDestination(`/inbox/${thread}`)).toBe(`/inbox/${thread}`);
  expect(safeDestination('/inbox')).toBe('/inbox');
  await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());
});

test('unavailable history has explicit retry and recovers without fabricated content', async () => {
  fixture();
  let unavailable = true;
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('limit') === '31' && unavailable)
        return HttpResponse.json({ code: 'synthetic' }, { status: 503 });
      return HttpResponse.json([message(32)]);
    }),
  );
  await screen.findByText(
    'History could not be loaded. Check your connection and retry.',
  );
  expect(screen.queryByLabelText('Message draft')).not.toBeInTheDocument();
  unavailable = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  await screen.findByLabelText('Message draft');
  expect(
    screen.getByText('<script>plain text</script>', { selector: 'p' }),
  ).toBeInTheDocument();
});

test('older-history failure retains current messages and draft, then retries the same exclusive cursor', async () => {
  fixture();
  await screen.findByText('<script>plain text</script>', { selector: 'p' });
  await userEvent.type(
    screen.getByLabelText('Message draft'),
    'Keep this draft',
  );
  let fail = true;
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get('message_order') === 'lt.3') {
        if (fail)
          return HttpResponse.json({ code: 'synthetic' }, { status: 503 });
        return HttpResponse.json([message(2), message(1)]);
      }
      return HttpResponse.json(
        Array.from({ length: 31 }, (_, i) => message(32 - i)),
      );
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Load older messages' }),
  );
  await screen.findByText(
    'History could not be updated. Refresh history or retry loading older messages.',
  );
  expect(
    screen.getByText('<script>plain text</script>', { selector: 'p' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Message draft')).toHaveValue('Keep this draft');
  fail = false;
  await userEvent.click(
    screen.getByRole('button', { name: 'Load older messages' }),
  );
  await screen.findByText('Message 1');
  expect(screen.getByLabelText('Message draft')).toHaveValue('Keep this draft');
});

const saved = (
  payload: { conversation_id: string; body: string; client_message_id: string },
  order = 33,
) => ({
  ...message(order),
  ...payload,
  sender_id: alice,
});

test('pending and failed sends retain text across navigation; explicit retry sends the identical payload and replaces the bubble with saved history', async () => {
  fixture();
  const user = userEvent.setup();
  const payloads: {
    conversation_id: string;
    body: string;
    client_message_id: string;
  }[] = [];
  let fail = true;
  server.use(
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) => {
        const payload = (await request.json()) as (typeof payloads)[number];
        payloads.push(payload);
        await delay(100);
        return fail
          ? HttpResponse.json({}, { status: 503 })
          : HttpResponse.json(saved(payload));
      },
    ),
  );
  await screen.findByLabelText('Message draft');
  await user.type(screen.getByLabelText('Message draft'), 'Kept message');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(screen.getByText('Sending…')).toBeVisible();
  expect(screen.getByLabelText('Message draft')).toHaveValue('');
  await screen.findByRole('button', { name: 'Retry message' });
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*No messages yet/ }),
  );
  await screen.findByLabelText('Message draft');
  await user.type(screen.getByLabelText('Message draft'), 'Other thread draft');
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*plain text/ }),
  );
  await screen.findByRole('button', { name: 'Retry message' });
  await user.type(screen.getByLabelText('Message draft'), 'Next draft');
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry message' }));
  await screen.findByText('Sent', { exact: true });
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(screen.getAllByText('Kept message', { selector: 'p' })).toHaveLength(
    1,
  );
  expect(
    screen.queryByRole('button', { name: 'Retry message' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Message draft')).toHaveValue('Next draft');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(payloads).toHaveLength(3));
  expect(payloads[2]?.client_message_id).not.toBe(
    payloads[0]?.client_message_id,
  );
  expect(payloads[2]?.body).toBe('Next draft');
  await waitFor(() =>
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument(),
  );
});

test('a committed message with a lost response is reconciled by client ID on refresh while an identical-body different message remains distinct', async () => {
  fixture();
  const user = userEvent.setup();
  let committed: ReturnType<typeof saved> | undefined;
  server.use(
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) => {
        committed = saved(
          (await request.json()) as Parameters<typeof saved>[0],
        );
        return HttpResponse.error();
      },
    ),
  );
  await screen.findByLabelText('Message draft');
  await user.type(screen.getByLabelText('Message draft'), 'Message 32');
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: 'Retry message' });
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', () =>
      HttpResponse.json([committed, { ...message(32), body: 'Message 32' }]),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await screen.findByText('Sent', { exact: true });
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry message' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getAllByText('Message 32', { selector: 'p' })).toHaveLength(2);
});

test('slow committed sends show a quiet delayed notice, timeout honestly, and exact retry reconciles the original saved message', async () => {
  fixture();
  const user = userEvent.setup();
  const payloads: Parameters<typeof saved>[0][] = [];
  server.use(
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) => {
        const payload = (await request.json()) as Parameters<typeof saved>[0];
        payloads.push(payload);
        if (payloads.length === 1) {
          await new Promise<void>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
        }
        return HttpResponse.json(saved(payload));
      },
    ),
  );
  await screen.findByLabelText('Message draft');
  await user.type(
    screen.getByLabelText('Message draft'),
    'Committed before timeout',
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  expect(
    screen.queryByText('Connecting… The API may be waking up.'),
  ).not.toBeInTheDocument();
  await screen.findByText(
    'Connecting… The API may be waking up.',
    {},
    { timeout: 4000 },
  );
  await screen.findByRole(
    'button',
    { name: 'Retry message' },
    { timeout: 16000 },
  );
  expect(screen.queryByText('Sent', { exact: true })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry message' }));
  await screen.findByText('Sent', { exact: true });
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(
    screen.getAllByText('Committed before timeout', { selector: 'p' }),
  ).toHaveLength(1);
}, 20000);

test('a stale history request cannot overwrite a send receipt committed while that read was in flight', async () => {
  fixture();
  const user = userEvent.setup();
  await screen.findByLabelText('Message draft');
  let started = false;
  let aborted = false;
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', async ({ request }) => {
      if (new URL(request.url).searchParams.get('limit') === '31') {
        started = true;
        await new Promise<void>((resolve) =>
          request.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
      }
      return HttpResponse.json([message(32)]);
    }),
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) =>
        HttpResponse.json(
          saved((await request.json()) as Parameters<typeof saved>[0]),
        ),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() => expect(started).toBe(true));
  await user.type(
    screen.getByLabelText('Message draft'),
    'Saved during stale read',
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByText('Sent', { exact: true });
  await waitFor(() => expect(aborted).toBe(true));
  expect(
    screen.getAllByText('Saved during stale read', { selector: 'p' }),
  ).toHaveLength(1);
});

test('retry receipt already observed on an older page stays unique and ordered', async () => {
  const { queries } = fixture();
  const user = userEvent.setup();
  let payload: Parameters<typeof saved>[0] | undefined;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let requests = 0;
  server.use(
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) => {
        payload = (await request.json()) as Parameters<typeof saved>[0];
        if (++requests === 1) return HttpResponse.error();
        await gate;
        return HttpResponse.json(saved(payload, 2));
      },
    ),
  );
  await screen.findByLabelText('Message draft');
  await user.type(
    screen.getByLabelText('Message draft'),
    'Saved on older page',
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('button', { name: 'Retry message' });
  await user.click(screen.getByRole('button', { name: 'Retry message' }));
  await waitFor(() => expect(requests).toBe(2));
  const key = ['private', alice, 'thread', thread, 'history'];
  queries.setQueryData(key, {
    pages: [
      { items: [message(32)], nextCursor: 32 },
      { items: [saved(payload!, 2), message(1)], nextCursor: undefined },
    ],
    pageParams: [undefined, 32],
  });
  finish();
  await waitFor(() =>
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(
      screen.getAllByText('Saved on older page', { selector: 'p' }),
    ).toHaveLength(1),
  );
  expect(
    [
      ...screen
        .getByRole('region', { name: 'Message history' })
        .querySelectorAll('[data-message-order]'),
    ].map((row) => Number(row.getAttribute('data-message-order'))),
  ).toEqual([1, 2, 32]);
  expect(
    queries.getQueryData<{ pages: { items: ReturnType<typeof saved>[] }[] }>(
      key,
    )?.pages[1]?.items[0]?.client_message_id,
  ).toBe(payload!.client_message_id);
});

test('a send completing during a fresh history load after navigation seeds saved state and reloads the rest of history', async () => {
  fixture();
  const user = userEvent.setup();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let payload: Parameters<typeof saved>[0] | undefined;
  server.use(
    http.post(
      'http://127.0.0.1:3001/api/v1/conversations/messages',
      async ({ request }) => {
        payload = (await request.json()) as Parameters<typeof saved>[0];
        await gate;
        return HttpResponse.json(saved(payload));
      },
    ),
  );
  await screen.findByLabelText('Message draft');
  await user.type(
    screen.getByLabelText('Message draft'),
    'Saved while returning',
  );
  await user.click(screen.getByRole('button', { name: 'Send message' }));
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*No messages yet/ }),
  );
  await screen.findByLabelText('Message draft');
  let reads = 0;
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', async ({ request }) => {
      const url = new URL(request.url);
      if (
        url.searchParams.get('limit') === '31' &&
        url.searchParams.get('conversation_id') === `eq.${thread}`
      ) {
        if (++reads === 1)
          await new Promise<void>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
        return HttpResponse.json([saved(payload!), message(32)]);
      }
      return HttpResponse.json([]);
    }),
  );
  await user.click(
    screen.getByRole('link', { name: /Reader Bob.*plain text/ }),
  );
  await waitFor(() => expect(reads).toBe(1));
  finish();
  await screen.findByLabelText('Message draft');
  await screen.findByText('<script>plain text</script>', { selector: 'p' });
  expect(
    screen.getAllByText('Saved while returning', { selector: 'p' }),
  ).toHaveLength(1);
  expect(reads).toBe(2);
});

test('manual refresh failure retains current history and unsent draft, then recovers explicitly', async () => {
  fixture();
  const user = userEvent.setup();
  await screen.findByLabelText('Message draft');
  await user.type(
    screen.getByLabelText('Message draft'),
    'Draft during refresh',
  );
  let fail = true;
  server.use(
    http.get('http://127.0.0.1:55439/rest/v1/messages', () =>
      fail
        ? HttpResponse.error()
        : HttpResponse.json([message(32), message(31)]),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await screen.findByText(
    'History could not be updated. Refresh history or retry loading older messages.',
  );
  expect(
    screen.getByText('<script>plain text</script>', { selector: 'p' }),
  ).toBeVisible();
  expect(screen.getByLabelText('Message draft')).toHaveValue(
    'Draft during refresh',
  );
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText('Message draft')).toHaveValue(
    'Draft during refresh',
  );
});
