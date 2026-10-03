import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { apiRequest } from '../src/lib/api-client';
import { TradeLifecycle } from '../src/features/trades/TradeLifecycle';
import { useTrade } from '../src/features/trades/useTrades';
import type { TradeDetail } from '../src/features/trades/trades-api';
import { server } from './setup';

const self = 'a8ded912-c170-4988-8750-9747558e8a87';
const id = 'd8ded912-c170-4988-8750-9747558e8a87';
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: self } }, request: apiRequest }),
}));

function mount() {
  let detail: TradeDetail = {
    id,
    creatorId: self,
    status: 'confirmed',
    currentVersion: 1,
    expiresAt: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    participantCount: 2,
    itemCount: 2,
    hasUnavailableItems: true,
    participants: [],
    items: [],
    events: [],
    groupConversationId: null,
  };
  let code = '';
  let failRead = false;
  let calls = 0;
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  server.use(
    http.get('*/api/v1/trades/:id', () =>
      failRead
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json(detail),
    ),
    http.post('*/api/v1/trades/:id/cancel', async ({ request }) => {
      calls++;
      expect(await request.json()).toEqual({
        expectedVersion: 1,
        expectedStatus: 'confirmed',
      });
      if (code)
        return HttpResponse.json(
          { error: { code, message: 'Conflict', requestId: id } },
          { status: 409 },
        );
      detail = { ...detail, status: 'cancelled', hasUnavailableItems: false };
      return HttpResponse.json({ id, currentVersion: 1, status: 'cancelled' });
    }),
  );
  function Harness() {
    const trade = useTrade(id);
    return trade.data ? (
      <TradeLifecycle detail={trade.data} current={!trade.isError} />
    ) : null;
  }
  render(
    <QueryClientProvider client={queries}>
      <Harness />
    </QueryClientProvider>,
  );
  return {
    setCode: (value: string) => {
      code = value;
    },
    setReadFailure: () => {
      failRead = true;
    },
    calls: () => calls,
    queries,
  };
}

test('requires explicit cancellation and retains closed history copy after authoritative refresh', async () => {
  const state = mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Cancel confirmed swap' }),
  );
  expect(state.calls()).toBe(0);
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'before any reported handover or receipt',
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm cancellation' }),
  );
  await screen.findByText(/cancelled, not completed/);
  expect(state.calls()).toBe(1);
  expect(
    screen.queryByRole('button', { name: 'Cancel confirmed swap' }),
  ).not.toBeInTheDocument();
});

test('explains recorded handover rejection and never claims release', async () => {
  const state = mount();
  state.setCode('HANDOVER_RECORDED');
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Cancel confirmed swap' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm cancellation' }),
  );
  await screen.findByText(/items have not been released/);
  expect(
    screen.getByRole('button', { name: 'Confirm cancellation' }),
  ).toBeDisabled();
  expect(
    screen.queryByText(/cancelled, not completed/),
  ).not.toBeInTheDocument();
});

test('failed authoritative read disables lifecycle writes until status recovers', async () => {
  const state = mount();
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Cancel confirmed swap' });
  state.setReadFailure();
  await user.click(screen.getByRole('button', { name: 'Refresh swap status' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Cancel confirmed swap' }),
    ).toBeDisabled(),
  );
  expect(state.calls()).toBe(0);
});

test('recorded receipt disables ordinary cancellation with an explanation', async () => {
  const state = mount();
  await screen.findByRole('button', { name: 'Cancel confirmed swap' });
  state.queries.setQueryData<TradeDetail>(
    ['private', self, 'trade', id],
    (detail) =>
      detail && {
        ...detail,
        events: [
          {
            id,
            actorId: self,
            version: 1,
            eventType: 'receipt_acknowledged',
            createdAt: detail.createdAt,
          },
        ],
      },
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Cancel confirmed swap' }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByText(/Cancellation is unavailable after a receipt/),
  ).toBeVisible();
  expect(state.calls()).toBe(0);
});
