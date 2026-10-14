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
    data,
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
    await screen.findByRole('button', { name: 'Review meetup' }),
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
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByText('Public library')).toBeVisible();
  expect(fixture.payloads[1]).toEqual(fixture.payloads[0]);
  expect(
    screen.queryByText('Bob · Meeting response pending'),
  ).not.toBeInTheDocument();
});

test('stale updates retain the draft and require explicit reuse; repeated times require choice', async () => {
  const user = userEvent.setup();
  const fixture = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Review meetup' }),
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
  fireEvent.change(screen.getByLabelText('Date'), {
    target: { value: '2026-10-25' },
  });
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Minute' }),
    '29',
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Minute' }),
    '30',
  );
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

test('shows place, date and zoned time with response actions outside the form', async () => {
  mount();
  expect(
    await screen.findByRole('button', { name: 'Review meetup' }),
  ).toBeVisible();
  expect(screen.getByText('Date')).toBeVisible();
  expect(screen.getByText('Time')).toBeVisible();
  expect(screen.getByText('Place')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Confirm this meeting' }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Decline this meeting' }),
  ).toBeVisible();
  expect(screen.queryByText(/Meeting responses/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Your time:/)).not.toBeInTheDocument();
});

test('meetup form omits introductory and repeated time explanations', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: 'Review meetup' }),
  );
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByLabelText('Time zone')).toBeVisible();
  expect(
    screen.queryByLabelText('HTTPS map link (optional)'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Review the place and time before confirming/),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Use an IANA zone/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Your time:/)).not.toBeInTheDocument();
});

test('time has separate hour and minute dropdowns under one label', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: 'Review meetup' }),
  );
  const hour = screen.getByRole('combobox', { name: 'Hour' });
  const minute = screen.getByRole('combobox', { name: 'Minute' });
  expect(hour).toHaveValue('02');
  expect(minute).toHaveValue('30');
  await user.selectOptions(hour, '15');
  await user.selectOptions(minute, '45');
  expect(hour).toHaveValue('15');
  expect(minute).toHaveValue('45');
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});

test('time zone dropdown includes common zones and updates the selected zone', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole('button', { name: 'Review meetup' }),
  );
  const zone = screen.getByRole('combobox', { name: 'Time zone' });
  expect(zone).toHaveValue('Europe/Paris');
  await user.selectOptions(zone, 'America/New_York');
  expect(zone).toHaveValue('America/New_York');
  expect(screen.getByLabelText('Date')).toHaveValue('2026-10-25');
  expect(screen.getByLabelText('Hour')).toHaveValue('02');
  expect(screen.getByLabelText('Minute')).toHaveValue('30');
});

test('confirm and decline sit outside the review form', async () => {
  const user = userEvent.setup();
  mount();
  const confirm = await screen.findByRole('button', {
    name: 'Confirm this meeting',
  });
  const decline = screen.getByRole('button', { name: 'Decline this meeting' });
  expect(confirm).toBeEnabled();
  expect(decline).toBeEnabled();
  expect(confirm.closest('form')).toBeNull();
  expect(confirm.closest('.meetup-footer-actions')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Review meetup' }));
  expect(
    screen.getByRole('dialog').querySelector('.meetup-response-actions'),
  ).toBeNull();
});

test('reminds users to save and requests confirmation before notifying others', async () => {
  const user = userEvent.setup();
  mount();
  let confirmations = 0;
  server.use(
    http.post('*/api/v1/trades/:id/meeting/respond', () => {
      confirmations++;
      return new HttpResponse(null, { status: 503 });
    }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Review meetup' }),
  );
  expect(
    screen.getByText('Save your meetup options before confirming.'),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await user.click(
    screen.getByRole('button', { name: 'Confirm this meeting' }),
  );
  expect(
    screen.getByText(
      'Confirming will notify the other user that you are ready to meet them 🎉',
    ),
  ).toBeVisible();
  expect(confirmations).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Go back' }));
  expect(confirmations).toBe(0);
  await user.click(
    screen.getByRole('button', { name: 'Confirm this meeting' }),
  );
  await user.click(screen.getByRole('button', { name: 'Confirm and notify' }));
  await screen.findByRole('button', { name: 'Retry confirmation' });
  expect(confirmations).toBe(1);
});

test('declining asks before notifying the other user', async () => {
  const user = userEvent.setup();
  mount();
  let submissions = 0;
  server.use(
    http.post('*/api/v1/trades/:id/meeting/respond', async ({ request }) => {
      submissions++;
      expect(await request.json()).toMatchObject({ response: 'declined' });
      return new HttpResponse(null, { status: 503 });
    }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Decline this meeting' }),
  );
  expect(
    screen.getByText(
      'Declining will notify the other user that you won’t be meeting them.',
    ),
  ).toBeVisible();
  expect(submissions).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Go back' }));
  expect(submissions).toBe(0);
  await user.click(
    screen.getByRole('button', { name: 'Decline this meeting' }),
  );
  await user.click(screen.getByRole('button', { name: 'Decline and notify' }));
  await screen.findByRole('button', { name: 'Retry decline' });
  expect(submissions).toBe(1);
});

for (const response of ['confirmed', 'declined'] as const) {
  test(`shows a success toast only after ${response} is saved`, async () => {
    const user = userEvent.setup();
    const fixture = mount();
    server.use(
      http.post('*/api/v1/trades/:id/meeting/respond', () =>
        HttpResponse.json({
          ...fixture.data(),
          responses: fixture
            .data()
            .responses.map((person) =>
              person.userId === self ? { ...person, response } : person,
            ),
        }),
      ),
    );
    await user.click(
      await screen.findByRole('button', {
        name:
          response === 'confirmed'
            ? 'Confirm this meeting'
            : 'Decline this meeting',
      }),
    );
    const message =
      response === 'confirmed'
        ? 'Meetup confirmed. The other participants have been notified.'
        : 'Meetup declined. The other participants have been notified.';
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name:
          response === 'confirmed'
            ? 'Confirm and notify'
            : 'Decline and notify',
      }),
    );
    expect(await screen.findByText(message)).toHaveAttribute('role', 'status');
    await user.click(
      screen.getByRole('button', { name: 'Dismiss notification' }),
    );
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });
}
