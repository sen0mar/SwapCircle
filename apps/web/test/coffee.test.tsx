import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { apiRequest } from '../src/lib/api-client';
import { TradeCoffee } from '../src/features/trades/TradeCoffee';
import type { TradeDetail } from '../src/features/trades/trades-api';
import { server } from './setup';

const self = 'a8ded912-c170-4988-8750-9747558e8a87';
const bob = 'b8ded912-c170-4988-8750-9747558e8a87';
const carol = 'c8ded912-c170-4988-8750-9747558e8a87';
const tradeId = 'd8ded912-c170-4988-8750-9747558e8a87';
const invitationId = 'e8ded912-c170-4988-8750-9747558e8a87';
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: self } }, request: apiRequest }),
}));

function mount(count = 2, recipient = false) {
  let eligibleCount = count;
  const payloads: Record<string, unknown>[] = [];
  let fail = false;
  let invitations: Record<string, unknown>[] = recipient
    ? [
        {
          id: invitationId,
          tradeId,
          inviterId: bob,
          inviteeId: self,
          offerToPay: true,
          status: 'pending',
          createdAt: '2026-10-02T08:00:00.000Z',
          respondedAt: null,
        },
      ]
    : [];
  const root = 'http://127.0.0.1:3001/api/v1';
  server.use(
    http.get(`${root}/trades/:id/coffee/eligibility`, ({ request }) => {
      const inviteeId = new URL(request.url).searchParams.get('inviteeId');
      const size = inviteeId === carol ? 1 : eligibleCount;
      return HttpResponse.json({
        tradeId,
        inviterId: self,
        inviteeId,
        eligible: size >= 2,
        sharedInterests: [
          { id: self, name: 'Books' },
          { id: bob, name: 'Hiking' },
        ].slice(0, size),
      });
    }),
    http.get(`${root}/trades/:id/coffee`, () => HttpResponse.json(invitations)),
    http.post(`${root}/trades/:id/coffee`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      payloads.push(body);
      if (fail) return new HttpResponse(null, { status: 503 });
      const invitation = {
        id: invitationId,
        tradeId,
        inviterId: self,
        inviteeId: body.inviteeId,
        offerToPay: body.offerToPay,
        status: 'pending',
        createdAt: '2026-10-02T08:00:00.000Z',
        respondedAt: null,
      };
      invitations = [invitation];
      return HttpResponse.json(invitation);
    }),
    http.post(
      `${root}/trades/:id/coffee/:invitation/respond`,
      async ({ request }) => {
        const body = (await request.json()) as { action: string };
        payloads.push(body);
        invitations = invitations.map((i) => ({
          ...i,
          status:
            body.action === 'decline'
              ? 'declined'
              : body.action === 'cancel'
                ? 'cancelled'
                : 'accepted',
          respondedAt: '2026-10-02T09:00:00.000Z',
        }));
        return HttpResponse.json(invitations[0]);
      },
    ),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const detail = {
    id: tradeId,
    status: 'proposed',
    participants: [
      { userId: self, displayName: 'You' },
      { userId: bob, displayName: 'Bob' },
      { userId: carol, displayName: 'Carol' },
    ],
  } as TradeDetail;
  render(
    <QueryClientProvider client={queries}>
      <TradeCoffee detail={detail} />
    </QueryClientProvider>,
  );
  return {
    payloads,
    count: (value: number) => {
      eligibleCount = value;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    queries,
  };
}

test('one shared interest hides coffee and preserves the default swap option', async () => {
  mount(1);
  await within(
    screen.getByRole('region', { name: 'Coffee with Bob' }),
  ).findByText('Books');
  await waitFor(() =>
    expect(screen.queryAllByText('Checking shared interests…')).toHaveLength(0),
  );
  expect(screen.queryByLabelText('Swap + coffee')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Coffee on me')).not.toBeInTheDocument();
  expect(
    screen
      .getAllByLabelText('Meet to swap')
      .every((i) => (i as HTMLInputElement).checked),
  ).toBe(true);
});

test('eligible pair shows actual tags, unchecked offer and retries identical input/key', async () => {
  const user = userEvent.setup();
  const fixture = mount();
  const pair = within(screen.getByRole('region', { name: 'Coffee with Bob' }));
  await pair.findByLabelText('Swap + coffee');
  expect(pair.getByText('Books')).toBeVisible();
  expect(pair.getByText('Hiking')).toBeVisible();
  expect(pair.getByLabelText('Meet to swap')).toBeChecked();
  expect(pair.queryByLabelText('Coffee on me')).toBeNull();
  await user.click(pair.getByLabelText('Swap + coffee'));
  expect(pair.getByLabelText('Coffee on me')).not.toBeChecked();
  await user.click(pair.getByLabelText('Coffee on me'));
  fixture.fail(true);
  await user.click(
    pair.getByRole('button', { name: 'Send coffee invitation' }),
  );
  await pair.findByRole('button', { name: 'Retry coffee action' });
  expect(pair.getByLabelText('Coffee on me')).toBeChecked();
  fixture.fail(false);
  await user.click(pair.getByRole('button', { name: 'Retry coffee action' }));
  await pair.findByText('You invited Bob. Their coffee response is pending.');
  expect(fixture.payloads).toHaveLength(2);
  expect(fixture.payloads[1]).toEqual(fixture.payloads[0]);
  expect(fixture.payloads[0]?.offerToPay).toBe(true);
  expect(
    within(
      screen.getByRole('region', { name: 'Coffee with Carol' }),
    ).queryByLabelText('Swap + coffee'),
  ).toBeNull();
});

test('eligibility refresh hides invitation controls while preserving selection and offer', async () => {
  const fixture = mount();
  const user = userEvent.setup();
  const pair = within(screen.getByRole('region', { name: 'Coffee with Bob' }));
  await user.click(await pair.findByLabelText('Swap + coffee'));
  await user.click(pair.getByLabelText('Coffee on me'));
  fixture.count(1);
  await user.click(
    pair.getByRole('button', { name: 'Refresh coffee with Bob' }),
  );
  await pair.findByText(/Your coffee selection is preserved/);
  expect(pair.queryByLabelText('Coffee on me')).toBeNull();
  expect(
    pair.queryByRole('button', { name: 'Send coffee invitation' }),
  ).toBeNull();
  fixture.count(2);
  await user.click(
    pair.getByRole('button', { name: 'Refresh coffee with Bob' }),
  );
  expect(await pair.findByLabelText('Coffee on me')).toBeChecked();
  expect(fixture.payloads).toHaveLength(0);
});

test('decline is independent and pair history names both participants', async () => {
  const fixture = mount(2, true);
  const pair = within(screen.getByRole('region', { name: 'Coffee with Bob' }));
  await userEvent
    .setup()
    .click(await pair.findByRole('button', { name: 'Decline coffee' }));
  await screen.findByText(/Bob → You · Coffee declined/);
  expect(fixture.payloads).toEqual([{ action: 'decline' }]);
});

test('unexpected success response keeps the send key for safe recovery', async () => {
  const fixture = mount();
  const pair = within(screen.getByRole('region', { name: 'Coffee with Bob' }));
  const user = userEvent.setup();
  await user.click(await pair.findByLabelText('Swap + coffee'));
  let saved: unknown;
  server.use(
    http.post('*/api/v1/trades/:id/coffee', async ({ request }) => {
      saved = await request.json();
      return HttpResponse.json({ unexpected: true });
    }),
  );
  await user.click(
    pair.getByRole('button', { name: 'Send coffee invitation' }),
  );
  await pair.findByRole('button', { name: 'Retry coffee action' });
  server.use(
    http.post('*/api/v1/trades/:id/coffee', async ({ request }) => {
      const input = await request.json();
      expect(input).toEqual(saved);
      return HttpResponse.json({
        id: invitationId,
        tradeId,
        inviterId: self,
        inviteeId: bob,
        offerToPay: false,
        status: 'pending',
        createdAt: '2026-10-02T08:00:00.000Z',
        respondedAt: null,
      });
    }),
  );
  await user.click(pair.getByRole('button', { name: 'Retry coffee action' }));
  await waitFor(() =>
    expect(
      pair.queryByRole('button', { name: 'Retry coffee action' }),
    ).toBeNull(),
  );
  expect(fixture.payloads).toHaveLength(0);
});

test('eligibility read denial does not prevent declining a current invitation', async () => {
  const fixture = mount(2, true);
  const pair = within(screen.getByRole('region', { name: 'Coffee with Bob' }));
  await pair.findByRole('button', { name: 'Decline coffee' });
  server.use(
    http.get(
      '*/api/v1/trades/:id/coffee/eligibility',
      () => new HttpResponse(null, { status: 403 }),
    ),
  );
  const user = userEvent.setup();
  await user.click(
    pair.getByRole('button', { name: 'Refresh coffee with Bob' }),
  );
  await pair.findByText(/Coffee eligibility could not be verified/);
  expect(pair.getByRole('button', { name: 'Accept coffee' })).toBeDisabled();
  await user.click(pair.getByRole('button', { name: 'Decline coffee' }));
  await screen.findByText(/Bob → You · Coffee declined/);
  expect(fixture.payloads).toEqual([{ action: 'decline' }]);
});
