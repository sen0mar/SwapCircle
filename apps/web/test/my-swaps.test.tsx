import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { test, expect, vi, beforeEach } from 'vitest';
import { MySwapsPage } from '../src/features/trades/MySwapsPage';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  items: [] as Record<string, unknown>[],
}));
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'self' } } }),
}));
vi.mock('../src/features/browse/listing-photos', () => ({
  useListingPhotos: () => ({ data: [] }),
  ListingImage: ({ title }: { title: string }) => <span>Photo: {title}</span>,
}));
vi.mock('../src/features/trades/useTrades', () => ({
  useAcceptedProposals: () => ({ data: { pages: [{ items: [] }] } }),
  useConfirmReceipt: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isError: false,
  }),
  useSwapSchedule: () => ({
    isPending: false,
    isError: false,
    data: { pages: [{ items: mocks.items }] },
  }),
}));

function swap(
  id: string,
  status: string,
  date: string | null,
  receipts: string[] = [],
) {
  return {
    id,
    status,
    currentVersion: 2,
    receiptUserIds: receipts,
    updatedAt: '2026-10-01T00:00:00Z',
    meeting: date ? { meetingAt: date, timeZone: 'Europe/Paris' } : null,
    itemPreviews: [
      {
        listingId: id,
        title: id,
        ownerId: 'self',
        recipientId: 'bob',
        recipientName: 'Bob',
        ownerName: 'Me',
      },
    ],
  };
}

function renderPage(initialEntry = '/swaps') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MySwapsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.items = [
    swap('Future swap', 'confirmed', '2099-01-01T12:00:00Z'),
    swap('Overdue swap', 'confirmed', '2020-01-01T12:00:00Z'),
    swap('Finished swap', 'completed', '2020-01-01T12:00:00Z'),
    swap('Unscheduled swap', 'confirmed', null),
    swap('Pending proposal', 'proposed', null),
    swap('Cancelled swap', 'cancelled', null),
  ];
});

test('upcoming and history are separate tab panels', () => {
  renderPage();
  const upcoming = within(
    screen.getByRole('tabpanel', { name: 'Upcoming swaps' }),
  );
  expect(upcoming.getByText('Overdue swap')).toBeVisible();
  expect(upcoming.getByText('Future swap')).toBeVisible();
  expect(upcoming.getByText('Date to arrange')).toBeVisible();
  expect(
    screen.queryByRole('tabpanel', { name: 'Swap history' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Pending proposal')).not.toBeInTheDocument();
  expect(screen.queryByText('Cancelled swap')).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'View swap: Future swap' }),
  ).toHaveAttribute('href', '/swaps/Future swap');
  expect(
    screen.getAllByRole('button', { name: 'Confirm swap completed' }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Swap history' }));
  expect(screen.getByRole('tab', { name: 'Swap history' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const history = within(
    screen.getByRole('tabpanel', { name: 'Swap history' }),
  );
  expect(history.getByText('Finished swap')).toBeVisible();
  expect(history.queryByText('Overdue swap')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('tabpanel', { name: 'Upcoming swaps' }),
  ).not.toBeInTheDocument();
});

test('explicit completion submits receipt with current version and stable retry key', () => {
  renderPage();
  const button = screen.getByRole('button', { name: 'Confirm swap completed' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mocks.mutate).toHaveBeenCalledWith({
    expectedVersion: 2,
    operationKey: expect.any(String),
  });
  expect(mocks.mutate.mock.calls[0]).toEqual(mocks.mutate.mock.calls[1]);
  expect(
    within(screen.getByRole('tabpanel', { name: 'Upcoming swaps' })).getByText(
      'Overdue swap',
    ),
  ).toBeInTheDocument();
});

test('personal history remains independent when switching tabs', () => {
  mocks.items = [
    swap('My completed swap', 'confirmed', '2020-01-01T12:00:00Z', ['self']),
    swap('Their completed swap', 'confirmed', '2020-01-01T12:00:00Z', ['bob']),
  ];
  renderPage();
  const upcoming = within(
    screen.getByRole('tabpanel', { name: 'Upcoming swaps' }),
  );
  expect(upcoming.queryByText('My completed swap')).not.toBeInTheDocument();
  expect(upcoming.getByText('Their completed swap')).toBeVisible();
  expect(
    upcoming.getByRole('button', { name: 'Confirm swap completed' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Swap history' }));
  const history = within(
    screen.getByRole('tabpanel', { name: 'Swap history' }),
  );
  expect(history.getByText('My completed swap')).toBeVisible();
  expect(history.queryByText('Their completed swap')).not.toBeInTheDocument();
  expect(
    history.queryByRole('button', { name: 'Confirm swap completed' }),
  ).not.toBeInTheDocument();
});

test('a saved personal confirmation moves the card without a shared status change', () => {
  mocks.items = [swap('My swap', 'confirmed', '2020-01-01T12:00:00Z')];
  const page = renderPage();
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm swap completed' }),
  );
  // The authenticated API refresh returns our persisted receipt while the other person has not confirmed.
  mocks.items = [
    swap('My swap', 'confirmed', '2020-01-01T12:00:00Z', ['self']),
  ];
  page.rerender(
    <MemoryRouter>
      <MySwapsPage />
    </MemoryRouter>,
  );
  expect(
    within(
      screen.getByRole('tabpanel', { name: 'Upcoming swaps' }),
    ).queryByText('My swap'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Swap history' }));
  expect(
    within(screen.getByRole('tabpanel', { name: 'Swap history' })).getByText(
      'My swap',
    ),
  ).toBeVisible();
});

test('organizes upcoming reminders by next action', () => {
  renderPage();
  expect(
    screen.getByRole('heading', { name: 'Ready to complete' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'Coming up' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('heading', { name: 'To arrange' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('tablist', { name: 'Swap views' })).toBeVisible();
  const card = within(
    screen.getByRole('link', { name: 'View swap: Overdue swap' }),
  );
  expect(card.getByText('You give')).toBeInTheDocument();
  expect(card.getByText('You receive')).toBeInTheDocument();
  expect(card.queryByText(/Europe\/Paris/)).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'View swap: Overdue swap' }),
  ).toHaveAccessibleDescription(/2020/);
});

test('tabs support arrow, Home and End keys with roving focus', () => {
  renderPage();
  const upcoming = screen.getByRole('tab', { name: 'Upcoming swaps' });
  const history = screen.getByRole('tab', { name: 'Swap history' });
  upcoming.focus();
  fireEvent.keyDown(upcoming, { key: 'ArrowRight' });
  expect(history).toHaveFocus();
  expect(history).toHaveAttribute('aria-selected', 'true');
  expect(upcoming).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(history, { key: 'ArrowRight' });
  expect(upcoming).toHaveFocus();
  fireEvent.keyDown(upcoming, { key: 'End' });
  expect(history).toHaveFocus();
  fireEvent.keyDown(history, { key: 'Home' });
  expect(upcoming).toHaveFocus();
  fireEvent.keyDown(upcoming, { key: 'ArrowLeft' });
  expect(history).toHaveFocus();
});

test('the history tab can be opened directly from the URL', () => {
  renderPage('/swaps?view=history');
  expect(screen.getByRole('tab', { name: 'Swap history' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tabpanel', { name: 'Swap history' })).toBeVisible();
  expect(
    screen.queryByRole('tabpanel', { name: 'Upcoming swaps' }),
  ).not.toBeInTheDocument();
});
