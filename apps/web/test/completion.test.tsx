import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { apiRequest } from '../src/lib/api-client';
import { TradeCompletion } from '../src/features/trades/TradeCompletion';
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
    participants: [self, 'b8ded912-c170-4988-8750-9747558e8a87'].map(
      (userId, index) => ({
        userId,
        displayName: index ? 'Bob' : 'Alice',
        invitationStatus: 'joined' as const,
        invitedAt: '2026-01-01T00:00:00.000Z',
        respondedAt: null,
        acceptedAt: null,
        acceptedVersion: 1,
      }),
    ),
    items: [],
    events: [],
    groupConversationId: null,
  };
  let code = '';
  let lose = false;
  const bodies: unknown[] = [];
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
    http.post('*/api/v1/trades/:id/:action', async ({ request, params }) => {
      calls++;
      const body = (await request.json()) as {
        operationKey: string;
        expectedVersion: number;
      };
      bodies.push(body);
      if (code)
        return HttpResponse.json(
          { error: { code, message: 'Conflict', requestId: id } },
          { status: 409 },
        );
      if (params.action === 'receipt' && !detail.events.length)
        detail = {
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
        };
      if (params.action === 'problem')
        detail = { ...detail, status: 'disputed' };
      if (lose) {
        lose = false;
        return HttpResponse.error();
      }
      return HttpResponse.json({
        id,
        currentVersion: 1,
        status: detail.status,
      });
    }),
  );
  function Harness() {
    const trade = useTrade(id);
    return trade.data ? (
      <TradeCompletion detail={trade.data} current={!trade.isError} />
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
    bodies,
    lose: () => {
      lose = true;
    },
    change: (next: Partial<TradeDetail>) => {
      detail = { ...detail, ...next };
    },
  };
}

test('explicit personal receipt shows named pending participants and does not complete', async () => {
  const state = mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Confirm my receipt' }),
  );
  expect(state.calls()).toBe(0);
  await user.click(
    screen.getByRole('button', { name: 'I received all my items' }),
  );
  await screen.findByRole('heading', { name: 'Waiting for receipts' });
  expect(screen.getByText('Bob · Receipt pending')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Your receipt is acknowledged' }),
  ).toBeDisabled();
  expect(state.calls()).toBe(1);
});

test('uncertain private report locks its draft and reuses the original key after close and state refresh', async () => {
  const state = mount();
  state.lose();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Report a problem' }),
  );
  await user.selectOptions(
    screen.getByLabelText('Problem type'),
    'partial_handover',
  );
  await user.type(
    screen.getByLabelText('Private report details'),
    '<private evidence>',
  );
  await user.click(
    screen.getByRole('button', { name: 'Submit private report' }),
  );
  await screen.findByText(/The outcome could not be verified/);
  expect(screen.getByLabelText('Private report details')).toBeDisabled();
  expect(screen.getByLabelText('Private report details')).toHaveValue(
    '<private evidence>',
  );
  await user.click(screen.getByRole('button', { name: 'Go back' }));
  await user.click(
    screen.getByRole('button', { name: 'Review saved submission' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Retry same submission' }),
  );
  await screen.findByText(
    'Your private report was submitted. The dispute is unresolved.',
  );
  expect(state.bodies[1]).toEqual(state.bodies[0]);
  expect(screen.queryByText('<private evidence>')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Confirm my receipt' }),
  ).toBeEnabled();
});

test('stale new submissions and unavailable reads are blocked without clearing the draft', async () => {
  const state = mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Report a problem' }),
  );
  await user.type(
    screen.getByLabelText('Private report details'),
    'Keep my draft',
  );
  state.change({ status: 'completed' });
  await state.queries.invalidateQueries();
  await screen.findByText(
    /The swap changed or its current status is unavailable/,
  );
  expect(
    screen.getByRole('button', { name: 'Submit private report' }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Private report details')).toHaveValue(
    'Keep my draft',
  );
  expect(state.calls()).toBe(0);
});

test('disputed receipt remains evidence and completed trades explain restrictions', async () => {
  const state = mount();
  state.change({ status: 'disputed' });
  await state.queries.invalidateQueries();
  await screen.findByRole('heading', { name: 'Dispute unresolved' });
  expect(screen.getByText(/will not complete or resolve/)).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Confirm my receipt' }));
  await user.click(
    screen.getByRole('button', { name: 'I received all my items' }),
  );
  await screen.findByText('Your receipt acknowledgement was saved.');
  expect(
    screen.getByRole('heading', { name: 'Dispute unresolved' }),
  ).toBeVisible();
  state.change({ status: 'completed' });
  await state.queries.invalidateQueries();
  await screen.findByRole('heading', { name: 'Swap completed' });
  expect(
    screen.queryByRole('button', { name: 'Report a problem' }),
  ).not.toBeInTheDocument();
});

test('unavailable authoritative state blocks a new action and keeps unsent report text', async () => {
  const state = mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: 'Report a problem' }),
  );
  await user.type(
    screen.getByLabelText('Private report details'),
    'Unsent evidence',
  );
  state.setReadFailure();
  await state.queries.invalidateQueries();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Submit private report' }),
    ).toBeDisabled(),
  );
  expect(screen.getByLabelText('Private report details')).toHaveValue(
    'Unsent evidence',
  );
  expect(state.calls()).toBe(0);
});
