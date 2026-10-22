import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect, vi } from 'vitest';
import { MySwapsPage } from '../src/features/trades/MySwapsPage';

vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'self' } } }),
}));
vi.mock('../src/features/browse/listing-photos', () => ({
  useListingPhotos: () => ({ data: [] }),
  ListingImage: ({ title }: { title: string }) => <span>Photo: {title}</span>,
}));
vi.mock('../src/features/trades/useTrades', () => ({
  useAcceptedProposals: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: [], nextCursor: null }] },
  }),
  useMyTrades: () => ({
    isPending: false,
    isError: false,
    data: {
      nextAfter: null,
      items: [
        {
          id: 'swap',
          status: 'completed',
          participantCount: 2,
          itemCount: 5,
          expiresAt: '2026-10-01T00:00:00Z',
          hasUnavailableItems: false,
          itemPreviews: [
            {
              listingId: 'camera',
              title: 'Film camera',
              ownerId: 'self',
              recipientId: 'bob',
              ownerName: 'Me',
              recipientName: 'Bob',
            },
            {
              listingId: 'book',
              title: 'Cookbook',
              ownerId: 'bob',
              recipientId: 'self',
              ownerName: 'Bob',
              recipientName: 'Me',
            },
            {
              listingId: 'lamp',
              title: 'Desk lamp',
              ownerId: 'bob',
              recipientId: 'self',
              ownerName: 'Bob',
              recipientName: 'Me',
            },
          ],
        },
      ],
    },
  }),
}));

test('identifies items, transfer direction, two-person swaps and completed status', () => {
  render(
    <MemoryRouter>
      <MySwapsPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'Item swap' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Film camera' }),
  ).toBeInTheDocument();
  expect(screen.getByText('You give')).toBeInTheDocument();
  expect(screen.getAllByText('You receive')).toHaveLength(2);
  expect(screen.getAllByText('Bob → you')).toHaveLength(2);
  expect(screen.getByText('Completed', { exact: true })).toBeInTheDocument();
  expect(
    screen.getByText('+2 more items · View the full swap'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Respond before/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /View swap: Film camera/ }),
  ).toHaveAttribute('href', '/swaps/swap');
});

test.each(['self', 'recipient'])(
  'accepted swaps show the agreed items in the correct direction for %s',
  async (userId) => {
    const { AcceptedSwapCard } =
      await import('../src/features/trades/AcceptedSwapCard');
    const { within } = await import('@testing-library/react');
    const { container } = render(
      <MemoryRouter>
        <AcceptedSwapCard
          userId={userId}
          item={{
            message: {
              id: 'message',
              client_message_id: 'client-message',
              message_order: 1,
              conversation_id: 'conversation',
              sender_id: 'self',
              body: 'A small lamp',
              created_at: '2026-10-01T00:00:00Z',
              has_photo: false,
              proposal: {
                listingId: 'keyboard',
                listingTitle: 'Desktop keyboard',
                message: 'A small lamp',
                condition: 'good',
              },
            },
            response: {
              status: 'accepted',
              messageId: 'message',
              conversationId: 'conversation',
              recipientId: 'recipient',
              respondedAt: '2026-10-01T00:01:00Z',
            },
            senderName: 'Alice',
            recipientName: 'Bob',
          }}
        />
      </MemoryRouter>,
    );
    const card = within(container);
    expect(
      card.getByRole('heading', { name: 'Item swap' }),
    ).toBeInTheDocument();
    expect(card.getByText('Accepted')).toBeInTheDocument();
    expect(card.queryByText('Trade proposal')).not.toBeInTheDocument();
    const items = card.getAllByRole('listitem');
    expect(
      within(items[0]!).getByText(
        userId === 'self' ? 'You receive' : 'You give',
      ),
    ).toBeInTheDocument();
    expect(
      within(items[1]!).getByText(
        userId === 'self' ? 'You give' : 'You receive',
      ),
    ).toBeInTheDocument();
    expect(card.getByText('Good')).toBeInTheDocument();
    expect(
      card.getByRole('link', { name: 'Open swap conversation' }),
    ).toHaveAttribute('href', '/inbox/conversation');
  },
);
