import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import type { Listing } from '@swapcircle/contracts';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { ProposalComposer } from '../src/features/browse/ProposalComposer';
import { server } from './setup';

const ids = {
  self: 'a8ded912-c170-4988-8750-9747558e8a87',
  owner: 'b8ded912-c170-4988-8750-9747558e8a87',
  third: 'c8ded912-c170-4988-8750-9747558e8a87',
  fourth: 'd8ded912-c170-4988-8750-9747558e8a87',
  bicycle: 'a329028e-1971-4763-b371-1ac4587c640a',
  lamp: 'b329028e-1971-4763-b371-1ac4587c640a',
  books: 'c329028e-1971-4763-b371-1ac4587c640a',
  plant: 'd329028e-1971-4763-b371-1ac4587c640a',
  bag: 'e329028e-1971-4763-b371-1ac4587c640a',
};

function listing(id: string, ownerId: string, title: string): Listing {
  return {
    id,
    ownerId,
    title,
    description: 'A useful item',
    condition: 'good',
    availability: 'available',
    revision: 1,
    createdAt: '2026-09-24T08:00:00.000Z',
    updatedAt: '2026-09-24T08:00:00.000Z',
  };
}

const items = [
  listing(ids.bicycle, ids.owner, 'Bicycle'),
  listing(ids.lamp, ids.self, 'Desk lamp'),
  listing(ids.books, ids.third, 'Books'),
  listing(ids.plant, ids.fourth, 'Plant'),
  listing(ids.bag, ids.self, 'Canvas bag'),
];

function mount() {
  const session = {
    user: { id: ids.self },
    access_token: 'synthetic',
  } as Session;
  const client = {
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      getSession: async () => ({ data: { session }, error: null }),
    },
    removeAllChannels: async () => [],
  } as unknown as SupabaseClient;
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let writes = 0;
  const payloads: unknown[] = [];

  server.use(
    http.get('http://127.0.0.1:3001/api/v1/profiles/me', () =>
      HttpResponse.json({
        id: ids.self,
        displayName: 'You',
        biography: '',
        approximateLocation: '',
        interests: [],
        avatarUrl: null,
        avatarCleanupPending: false,
        createdAt: '2026-09-24T08:00:00.000Z',
        updatedAt: '2026-09-24T08:00:00.000Z',
      }),
    ),
    http.get('http://127.0.0.1:3001/api/v1/members', () =>
      HttpResponse.json({
        items: [
          { id: ids.third, displayName: 'Casey' },
          { id: ids.fourth, displayName: 'Drew' },
        ].map((member) => ({
          ...member,
          biography: '',
          approximateLocation: '',
          interests: [],
          avatarUrl: null,
          sharedInterests: [],
          sharedInterestCount: null,
        })),
        nextCursor: null,
      }),
    ),
    http.get('http://127.0.0.1:3001/api/v1/listings', ({ request }) => {
      const owner = new URL(request.url).searchParams.get('owner');
      return HttpResponse.json({
        items: items.filter((item) => item.ownerId === owner),
        nextCursor: null,
      });
    }),
    http.get('http://127.0.0.1:3001/api/v1/listings/:id', ({ params }) => {
      const item = items.find((candidate) => candidate.id === params.id);
      return item
        ? HttpResponse.json(item)
        : new HttpResponse(null, { status: 404 });
    }),
    http.post('http://127.0.0.1:3001/api/v1/trades', async ({ request }) => {
      writes++;
      payloads.push(await request.json());
      if (writes === 1) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json(
        { id: ids.bicycle, currentVersion: 1, status: 'proposed' },
        { status: 201 },
      );
    }),
  );

  render(
    <QueryClientProvider client={queries}>
      <AuthProvider client={client}>
        <MemoryRouter>
          <ProposalComposer item={items[0]!} ownerName="Alex" />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { user: userEvent.setup(), writes: () => writes, payloads };
}

test('failed submission keeps the same operation key for retry', async () => {
  const { user, writes, payloads } = mount();

  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Desk lamp' }));
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await screen.findByRole('button', { name: 'Send proposal' });
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'request could not be completed',
  );
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  expect(writes()).toBe(2);
  expect(payloads[0]).toEqual(payloads[1]);
});

test('direct proposal explains missing offer and never submits when closed', async () => {
  const { user, writes } = mount();

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Each person needs at least one offered item',
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Desk lamp' }));
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));

  const summary = await screen.findByRole('list', { name: 'Trade transfers' });
  expect(within(summary).getAllByRole('listitem')[0]).toHaveTextContent(
    /Alex gives Bicycle to You/,
  );
  expect(within(summary).getAllByRole('listitem')[1]).toHaveTextContent(
    /You gives Desk lamp to Alex/,
  );
  expect(screen.getByText(/Items are not reserved/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit draft' }));
  await user.click(
    screen.getByRole('button', { name: 'Keep draft and close' }),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(writes()).toBe(0);

  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  expect(screen.getByRole('checkbox', { name: 'Desk lamp' })).toBeChecked();
});

test('four-person multi-item preview identifies every giver and recipient', async () => {
  const { user, writes } = mount();

  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  const add = await screen.findByRole('combobox', { name: 'Add a person' });
  await user.selectOptions(add, ids.third);
  await user.selectOptions(add, ids.fourth);
  await user.click(await screen.findByRole('checkbox', { name: 'Desk lamp' }));
  await user.click(screen.getByRole('checkbox', { name: 'Canvas bag' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Books' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Plant' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Alex gives Bicycle to' }),
    ids.third,
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Casey gives Books to' }),
    ids.fourth,
  );
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));

  const summary = await screen.findByRole('list', { name: 'Trade transfers' });
  expect(within(summary).getAllByRole('listitem')[0]).toHaveTextContent(
    /Alex gives Bicycle to Casey/,
  );
  expect(within(summary).getAllByRole('listitem')[3]).toHaveTextContent(
    /Casey gives Books to Drew/,
  );
  expect(within(summary).getAllByRole('listitem')).toHaveLength(5);
  expect(screen.getByText(/4 people/)).toBeInTheDocument();
  expect(writes()).toBe(0);
});

test('self transfer and a newly unavailable item block the preview with clear feedback', async () => {
  const { user, writes } = mount();

  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Desk lamp' }));
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Alex gives Bicycle to' }),
    ids.owner,
  );
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Choose a different recipient',
  );

  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Alex gives Bicycle to' }),
    ids.self,
  );
  server.use(
    http.get(`http://127.0.0.1:3001/api/v1/listings/${ids.bicycle}`, () =>
      HttpResponse.json({ ...items[0], availability: 'reserved' }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Bicycle is unavailable',
  );
  expect(
    screen.queryByRole('heading', { name: 'Review your proposal' }),
  ).not.toBeInTheDocument();
  expect(writes()).toBe(0);
});
