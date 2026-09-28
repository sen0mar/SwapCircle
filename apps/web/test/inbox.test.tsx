import { render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { createClient, type Session } from '@supabase/supabase-js';
import { http, HttpResponse, delay } from 'msw';
import { server } from './setup';
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
      <MemoryRouter initialEntries={[`/inbox/${thread}`]}>
        <Link to={`/inbox/${denied}`}>Denied fixture</Link>
        <Routes>
          <Route path="/inbox/:id" element={<InboxPage />} />
        </Routes>
      </MemoryRouter>
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
  expect(
    screen.getByRole('button', { name: 'Send unavailable' }),
  ).toBeDisabled();
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
    'Older history could not be loaded. Retry loading older messages.',
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
