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
  useMyTrades: () => ({
    isPending: false,
    isError: false,
    data: {
      nextAfter: null,
      items: [
        {
          id: 'swap',
          status: 'completed',
          participantCount: 3,
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
              recipientId: 'sam',
              ownerName: 'Bob',
              recipientName: 'Sam',
            },
          ],
        },
      ],
    },
  }),
}));

test('identifies items, transfer direction, group swaps and completed status', () => {
  render(
    <MemoryRouter>
      <MySwapsPage />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole('heading', { name: 'Group swap' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Film camera' }),
  ).toBeInTheDocument();
  expect(screen.getByText('You give')).toBeInTheDocument();
  expect(screen.getByText('You receive')).toBeInTheDocument();
  expect(screen.getByText('Bob → Sam')).toBeInTheDocument();
  expect(screen.getByText('Completed', { exact: true })).toBeInTheDocument();
  expect(
    screen.getByText('+2 more items · View the full swap'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Respond before/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: /View swap: Film camera/ }),
  ).toHaveAttribute('href', '/swaps/swap');
});
