import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { test, expect, vi } from 'vitest';
import { server } from './setup';
import { apiRequest } from '../src/lib/api-client';
import { GroupInvitation } from '../src/features/groups/GroupInvitation';

const id = '20000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000001';
const discard = vi.fn();
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: userId } },
    request: apiRequest,
    readSignal: new AbortController().signal,
  }),
}));
vi.mock('../src/features/inbox/MessageComposerProvider', () => ({
  useComposer: () => ({ discard }),
}));

function fixture(initial = 'pending') {
  let status = initial;
  let fail = false;
  const actions: string[] = [];
  server.use(
    http.get(`*/api/v1/conversations/${id}/invitation`, () =>
      HttpResponse.json({
        conversationId: id,
        tradeId: id,
        status,
        active: status === 'accepted',
        members: ['Alice', 'Bob', 'Carol', 'Dan'].map((displayName, index) => ({
          userId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          displayName,
          status: index === 0 ? status : 'pending',
          active: index === 0 && status === 'accepted',
        })),
      }),
    ),
    http.put(`*/api/v1/conversations/${id}/*`, ({ request }) => {
      const action = request.url.split('/').pop()!;
      actions.push(action);
      if (fail)
        return HttpResponse.json(
          {
            error: {
              code: 'UNAVAILABLE',
              message: 'Unavailable',
              requestId: 'synthetic',
            },
          },
          { status: 503 },
        );
      status =
        action === 'accept'
          ? 'accepted'
          : action === 'decline'
            ? 'declined'
            : 'left';
      return HttpResponse.json({
        conversationId: id,
        status,
        active: status === 'accepted',
      });
    }),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<GroupInvitation id={id} />} />
          <Route
            path="/inbox/:id"
            element={<p>Authorized group destination</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return {
    actions,
    queries,
    fail: () => {
      fail = true;
    },
  };
}

test('four members and independent consent; viewing makes no write and joining opens the group', async () => {
  const state = fixture();
  await screen.findByText('Dan · Invitation pending');
  expect(screen.getByText(/does not accept the trade terms/)).toBeVisible();
  expect(state.actions).toEqual([]);
  await userEvent.click(
    screen.getByRole('button', { name: 'Join group chat' }),
  );
  await screen.findByText('Authorized group destination');
  expect(state.actions).toEqual(['accept']);
});

test('decline is distinct, terminal, and does not accept any terms', async () => {
  const state = fixture();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Decline group chat' }),
  );
  await screen.findByText(/You cannot read or send group messages/);
  expect(state.actions).toEqual(['decline']);
  expect(screen.queryByRole('button', { name: 'Join group chat' })).toBeNull();
});

test('failed response preserves actionable invitation; leave requires explicit confirmation and clears history', async () => {
  const state = fixture('accepted');
  const key = ['private', userId, 'thread', id, 'history'];
  state.queries.setQueryData(key, { sensitive: 'synthetic cached group' });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Leave group chat' }),
  );
  expect(state.actions).toEqual([]);
  state.fail();
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm leave group chat' }),
  );
  await screen.findByRole('alert');
  await waitFor(() => expect(state.actions).toEqual(['leave']));
  expect(state.queries.getQueryData(key)).toBeDefined();
  expect(screen.getByText(/memory or devices/)).toBeVisible();
});

test('successful leave clears inaccessible history and local drafts after confirmation', async () => {
  const state = fixture('accepted');
  const key = ['private', userId, 'thread', id, 'history'];
  state.queries.setQueryData(key, { sensitive: 'synthetic history' });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Leave group chat' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm leave group chat' }),
  );
  await screen.findByText(/You cannot read or send group messages/);
  expect(state.queries.getQueryData(key)).toBeUndefined();
  expect(discard).toHaveBeenCalledWith(id);
});
