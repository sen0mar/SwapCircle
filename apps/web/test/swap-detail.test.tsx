import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect, vi } from 'vitest';
import { TradeDetailPage } from '../src/features/trades/TradeDetailPage';

vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'self' } } }),
}));
vi.mock('../src/features/browse/listing-photos', () => ({
  useListingPhotos: () => ({ data: [] }),
  ListingImage: ({ title }: { title: string }) => <span>Photo: {title}</span>,
}));
vi.mock('../src/features/trades/TradeAcceptance', () => ({
  TradeAcceptance: () => <div>Acceptance action</div>,
}));
vi.mock('../src/features/trades/TradeProblem', () => ({
  TradeProblem: () => null,
}));
vi.mock('../src/features/trades/TradeLifecycle', () => ({
  TradeLifecycle: () => <button>Cancel proposal</button>,
}));
vi.mock('../src/features/trades/TradeMeeting', () => ({
  TradeMeeting: () => <div>Meeting details</div>,
}));
vi.mock('../src/features/trades/TradeCoffee', () => ({
  TradeCoffee: () => <div>Coffee options</div>,
}));
vi.mock('../src/features/browse/ProposalComposer', () => ({
  ProposalComposer: () => null,
}));
vi.mock('../src/features/trades/useTrades', () => ({
  useTrade: () => ({
    isPending: false,
    isError: false,
    data: {
      id: 'swap',
      status: 'proposed',
      currentVersion: 1,
      participantCount: 2,
      itemCount: 1,
      expiresAt: '2026-11-01T00:00:00Z',
      groupConversationId: null,
      participants: [
        {
          userId: 'self',
          displayName: 'Me',
          invitationStatus: 'joined',
          acceptedVersion: null,
        },
        {
          userId: 'bob',
          displayName: 'Bob',
          invitationStatus: 'joined',
          acceptedVersion: null,
        },
      ],
      items: [
        {
          id: 'item',
          listingId: 'camera',
          ownerId: 'self',
          recipientId: 'bob',
          titleSnapshot: 'Film camera',
          descriptionSnapshot: 'Works well',
          conditionSnapshot: 'good',
          currentAvailability: 'available',
        },
      ],
      events: [],
    },
  }),
}));

test('puts the visual exchange first and keeps secondary sections collapsed', () => {
  render(
    <MemoryRouter>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Film camera' })).toBeVisible();
  expect(screen.getByText('To Bob')).toBeVisible();
  expect(screen.getByText('Acceptance action')).toBeVisible();
  expect(screen.queryByText('Meeting details')).not.toBeInTheDocument();
  expect(screen.queryByText('More options')).not.toBeInTheDocument();
  expect(screen.getByText('Coffee options')).not.toBeVisible();
  for (const label of ['Agreement details', 'Participants', 'Swap history']) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: 'Cancel proposal' })).toBeVisible();
  expect(screen.getAllByRole('heading', { name: 'Film camera' })).toHaveLength(
    1,
  );
});

test('coffee notification links open the targeted coffee section', () => {
  render(
    <MemoryRouter initialEntries={['/swaps/example#coffee']}>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByText('Coffee options')).toBeVisible();
});
