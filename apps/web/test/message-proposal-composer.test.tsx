import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import type { Listing, TradeMessageSubmission } from '@swapcircle/contracts';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { ProposalComposer } from '../src/features/browse/ProposalComposer';
import { server } from './setup';

vi.mock('../src/features/browse/listing-photos', () => ({
  useListingPhotos: () => ({ data: [] }),
  ListingImage: () => null,
}));
const self = 'a8ded912-c170-4988-8750-9747558e8a87';
const owner = 'b8ded912-c170-4988-8750-9747558e8a87';
const target = 'a329028e-1971-4763-b371-1ac4587c640a';
const offered = 'b329028e-1971-4763-b371-1ac4587c640a';
const date = '2026-09-24T08:00:00.000Z';
const item: Listing = {
  id: target,
  ownerId: owner,
  title: 'Bicycle',
  description: 'A useful item',
  condition: 'good',
  availability: 'available',
  revision: 1,
  createdAt: date,
  updatedAt: date,
};

function mount(failFirst = false) {
  const payloads: TradeMessageSubmission[] = [];
  const session = { user: { id: self }, access_token: 'synthetic' } as Session;
  const client = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
      getSession: async () => ({ data: { session }, error: null }),
    },
    removeAllChannels: async () => [],
  } as unknown as SupabaseClient;
  server.use(
    http.get('*/api/v1/listings', ({ request }) => {
      expect(new URL(request.url).searchParams.get('owner')).toBe(self);
      expect(new URL(request.url).searchParams.get('availability')).toBe(
        'available',
      );
      return HttpResponse.json({
        items: [{ ...item, id: offered, ownerId: self, title: 'Desk lamp' }],
        nextCursor: null,
      });
    }),
    http.post('*/api/v1/conversations/proposals', async ({ request }) => {
      const input = (await request.json()) as TradeMessageSubmission;
      payloads.push(input);
      if (failFirst && payloads.length === 1)
        return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({
        id: target,
        conversation_id: offered,
        sender_id: self,
        client_message_id: input.clientMessageId,
        body: input.body,
        message_order: 1,
        created_at: date,
      });
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AuthProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={<ProposalComposer item={item} ownerName="Alex" />}
            />
            <Route path="/inbox/:id" element={<p>Conversation opened</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), payloads };
}

test('shelf option sends only the selected item and message, preserving draft and retry identity', async () => {
  const { user, payloads } = mount(true);
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.click(screen.getByRole('radio', { name: 'Choose from my shelf' }));
  await user.click(await screen.findByRole('radio', { name: 'Desk lamp' }));
  await user.type(
    screen.getByLabelText('Message'),
    'Would you swap for my lamp?',
  );
  expect(screen.queryByText('Review proposal')).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Propose a trade' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Propose a trade' }));
  expect(screen.getByLabelText('Message')).toHaveValue(
    'Would you swap for my lamp?',
  );
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  await screen.findByText('Conversation opened');
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toEqual({
    listingId: target,
    offeredListingId: offered,
    body: 'Would you swap for my lamp?',
    clientMessageId: expect.any(String),
  });
  expect(payloads[1]).toEqual(payloads[0]);
});

test('photo option requires an item and sends photo bytes with the typed message', async () => {
  const { user, payloads } = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.type(screen.getByLabelText('Message'), 'Trade for this item?');
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upload a photo');
  expect(payloads).toHaveLength(0);
  await user.upload(
    screen.getByLabelText('Item photo'),
    new File(['synthetic photo'], 'item.png', { type: 'image/png' }),
  );
  await screen.findByAltText('Your offered item');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send proposal' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  await screen.findByText('Conversation opened');
  expect(payloads[0]).toEqual({
    listingId: target,
    body: 'Trade for this item?',
    photoBase64: btoa('synthetic photo'),
    clientMessageId: expect.any(String),
  });
});
