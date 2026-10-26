import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect, vi, beforeEach } from 'vitest';
import { TradeDetailPage } from '../src/features/trades/TradeDetailPage';
import { ApiError } from '../src/lib/api-client';

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
const reminder = vi.hoisted(() => ({
  status: 'proposed',
  pending: false,
  error: null as Error | null,
  refetch: vi.fn(),
  meeting: null as null | {
    meetingAt: string;
    timeZone: string;
    place: string | null;
    mapLink: string | null;
  },
}));
vi.mock('../src/features/trades/useMeetings', () => ({
  useMeeting: () => ({
    isPending: reminder.pending,
    isError: !!reminder.error,
    error: reminder.error,
    data: reminder.meeting,
    refetch: reminder.refetch,
  }),
}));
vi.mock('../src/features/inbox/MessageAction', () => ({
  MessageAction: () => <a href="/inbox/conversation">Message</a>,
}));

beforeEach(() => {
  reminder.status = 'proposed';
  reminder.pending = false;
  reminder.error = null;
  reminder.meeting = null;
  reminder.refetch.mockReset();
});
vi.mock('../src/features/trades/TradeCoffee', () => ({
  TradeCoffee: () => <div>Coffee options</div>,
}));
vi.mock('../src/features/browse/ProposalTermsEditor', () => ({
  ProposalTermsEditor: () => null,
}));
vi.mock('../src/features/trades/useTrades', () => ({
  useTrade: () => ({
    isPending: false,
    isError: false,
    data: {
      id: 'swap',
      status: reminder.status,
      currentVersion: 1,
      participantCount: 2,
      itemCount: 1,
      expiresAt: '2026-11-01T00:00:00Z',
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

test.each(['confirmed', 'completed'])(
  '%s swap details show only read-only meetup information and chat access',
  (status) => {
    reminder.status = status;
    reminder.meeting = {
      meetingAt: '2026-10-25T12:30:00Z',
      timeZone: 'Europe/Paris',
      place: 'Public library',
      mapLink: 'https://maps.example.test/library',
    };
    render(
      <MemoryRouter>
        <TradeDetailPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('region', { name: 'Meetup reminder' }),
    ).toBeVisible();
    expect(screen.getByText('Public library')).toBeVisible();
    expect(screen.getByText(/Europe\/Paris/)).toBeVisible();
    expect(document.querySelector('time')).toHaveAttribute(
      'dateTime',
      reminder.meeting.meetingAt,
    );
    expect(screen.getByRole('link', { name: 'View map' })).toHaveAttribute(
      'href',
      reminder.meeting.mapLink,
    );
    expect(screen.getByRole('link', { name: 'Message' })).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('Acceptance action')).not.toBeInTheDocument();
    expect(screen.queryByText('Coffee options')).not.toBeInTheDocument();
  },
);

test('missing meetup details direct the user to chat without a planning form', () => {
  reminder.status = 'confirmed';
  render(
    <MemoryRouter>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByText(/No meetup details saved yet/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Plan|Change|Confirm|Decline/ }),
  ).not.toBeInTheDocument();
});

test('read-only meetup loading and retry states remain available', () => {
  reminder.status = 'confirmed';
  reminder.pending = true;
  const page = render(
    <MemoryRouter>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByText('Loading meetup details…')).toBeVisible();
  reminder.pending = false;
  reminder.error = new Error('Offline');
  page.rerender(
    <MemoryRouter>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Meetup details could not be refreshed.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry meetup details' }));
  expect(reminder.refetch).toHaveBeenCalledOnce();
});

test('denied meetup reads hide previously cached meeting details', () => {
  reminder.status = 'confirmed';
  reminder.meeting = {
    meetingAt: '2026-10-25T12:30:00Z',
    timeZone: 'Europe/Paris',
    place: 'Cached meeting point',
    mapLink: 'https://maps.example.test/library',
  };
  reminder.error = new ApiError('Unavailable', 'MEETING_UNAVAILABLE', 403);
  render(
    <MemoryRouter>
      <TradeDetailPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Meetup details are unavailable.',
  );
  expect(screen.queryByText('Cached meeting point')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: 'View map' }),
  ).not.toBeInTheDocument();
});
