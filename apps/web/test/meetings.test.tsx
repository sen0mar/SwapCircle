import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { apiRequest } from '../src/lib/api-client';
import { TradeMeeting } from '../src/features/trades/TradeMeeting';
import {
  meetingInstants,
  localMeetingTime,
} from '../src/features/trades/meeting-time';
import type { TradeDetail } from '../src/features/trades/trades-api';
import { server } from './setup';

const self = 'a8ded912-c170-4988-8750-9747558e8a87';
const bob = 'b8ded912-c170-4988-8750-9747558e8a87';
const id = 'd8ded912-c170-4988-8750-9747558e8a87';
vi.mock('../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: self } }, request: apiRequest }),
}));

test('converts explicit zones and rejects invalid calendars, gaps and invalid zones', () => {
  expect(meetingInstants('2026-03-29T02:30', 'Europe/Paris')).toEqual([]);
  expect(meetingInstants('2026-02-30T12:00', 'UTC')).toEqual([]);
  expect(meetingInstants('2026-10-02T12:00', 'BAD')).toEqual([]);
  expect(meetingInstants('2026-10-02T12:00', 'Europe/Paris')).toEqual([
    '2026-10-02T10:00:00.000Z',
  ]);
  expect(localMeetingTime('2026-10-02T10:00:00.000Z', 'America/New_York')).toBe(
    '2026-10-02T06:00:00.000',
  );
});

test('returns both repeated hours and half-hour daylight transitions without choosing', () => {
  expect(meetingInstants('2026-10-25T02:30', 'Europe/Paris')).toEqual([
    '2026-10-25T00:30:00.000Z',
    '2026-10-25T01:30:00.000Z',
  ]);
  expect(
    meetingInstants('2026-04-05T01:45', 'Australia/Lord_Howe'),
  ).toHaveLength(2);
  expect(meetingInstants('2026-10-04T02:15', 'Australia/Lord_Howe')).toEqual(
    [],
  );
});

function mount() {
  let revision = 1;
  let fail = 0;
  const payloads: Record<string, unknown>[] = [];
  const data = () => ({
    id,
    tradeId: id,
    tradeVersion: 1,
    revision,
    place: 'Public library',
    mapLink: null,
    meetingAt: '2026-10-25T00:30:00.000Z',
    timeZone: 'Europe/Paris',
    responses: [
      { userId: self, response: null },
      { userId: bob, response: revision === 1 ? 'confirmed' : null },
    ],
  });
  const root = 'http://127.0.0.1:3001/api/v1/trades/:id/meeting';
  server.use(
    http.get(root, () => HttpResponse.json(data())),
    http.put(root, async ({ request }) => {
      payloads.push((await request.json()) as Record<string, unknown>);
      if (fail) return new HttpResponse(null, { status: fail });
      revision++;
      return HttpResponse.json(data());
    }),
  );
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <TradeMeeting
        detail={
          {
            id,
            currentVersion: 1,
            status: 'proposed',
            participants: [
              {
                userId: self,
                displayName: 'Alice',
                invitationStatus: 'joined',
              },
              { userId: bob, displayName: 'Bob', invitationStatus: 'joined' },
            ],
          } as TradeDetail
        }
      />
    </QueryClientProvider>,
  );
  return {
    payloads,
    fail: (value: number) => {
      fail = value;
    },
    revise: () => {
      revision++;
    },
  };
}

test('preserves drafts and retries the identical operation after uncertain failure', async () => {
  const user = userEvent.setup();
  const fixture = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Change meeting' }),
  );
  await user.clear(screen.getByLabelText('Public meeting place'));
  await user.type(
    screen.getByLabelText('Public meeting place'),
    'Public museum',
  );
  fixture.fail(503);
  await user.click(screen.getByRole('button', { name: 'Save meeting' }));
  await screen.findByText(/outcome could not be verified/);
  expect(screen.getByLabelText('Public meeting place')).toHaveValue(
    'Public museum',
  );
  expect(screen.getByRole('button', { name: 'Save meeting' })).toBeDisabled();
  fixture.fail(0);
  await user.click(
    screen.getByRole('button', { name: 'Retry meeting action' }),
  );
  await screen.findByText(/Changed arrangement/);
  expect(fixture.payloads[1]).toEqual(fixture.payloads[0]);
  expect(screen.getByText('Bob · Meeting response pending')).toBeVisible();
});

test('stale updates retain the draft and require explicit reuse; repeated times require choice', async () => {
  const user = userEvent.setup();
  const fixture = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Change meeting' }),
  );
  fixture.revise();
  fixture.fail(409);
  await user.click(screen.getByRole('button', { name: 'Save meeting' }));
  await screen.findByText(/The arrangement or trade changed/);
  expect(screen.getByRole('button', { name: 'Save meeting' })).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Reuse draft for current arrangement' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save meeting' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Date and time in arrangement zone'), {
    target: { value: '2026-10-25T02:30' },
  });
  // A freshly typed repeated time has no selected instant.
  expect(screen.getByLabelText(/First occurrence/)).not.toBeChecked();
  expect(screen.getByLabelText(/Second occurrence/)).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Save meeting' }));
  await screen.findByText(/Choose a valid local date/);
  expect(fixture.payloads).toHaveLength(1);
});

test('boundary years stay valid without throwing and fractional instants round-trip exactly', () => {
  for (const zone of ['UTC', 'Pacific/Kiritimati', 'America/New_York']) {
    expect(() => meetingInstants('9999-12-31T23:30', zone)).not.toThrow();
    expect(() => meetingInstants('0001-01-01T00:30', zone)).not.toThrow();
  }
  expect(meetingInstants('0001-01-01T12:00', 'UTC')).toEqual([
    '0001-01-01T12:00:00.000Z',
  ]);
  expect(meetingInstants('9999-12-31T12:00', 'UTC')).toEqual([
    '9999-12-31T12:00:00.000Z',
  ]);
  expect(meetingInstants('0000-01-01T12:00', 'UTC')).toEqual([]);
  const instant = '2026-10-25T01:30:12.123Z';
  expect(
    meetingInstants(localMeetingTime(instant, 'Europe/Paris'), 'Europe/Paris'),
  ).toContain(instant);
});
