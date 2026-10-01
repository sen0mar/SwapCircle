import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import type { Listing } from '@swapcircle/contracts';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { ProposalComposer } from '../src/features/browse/ProposalComposer';
import { TradeDetailPage } from '../src/features/trades/TradeDetailPage';
import type { TradeDetail } from '../src/features/trades/trades-api';
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

function mount(revision?: TradeDetail, detail = false) {
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
        <MemoryRouter initialEntries={[`/swaps/${ids.bicycle}`]}>
          {detail ? (
            <Routes>
              <Route path="/swaps/:id" element={<TradeDetailPage />} />
            </Routes>
          ) : revision ? (
            <ProposalComposer revision={revision} />
          ) : (
            <ProposalComposer item={items[0]!} ownerName="Alex" />
          )}
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

function proposal(version = 1): TradeDetail {
  return {
    id: ids.bicycle,
    creatorId: ids.self,
    status: 'proposed',
    currentVersion: version,
    expiresAt: '2027-01-01T00:00:00.000Z',
    createdAt: items[0]!.createdAt,
    updatedAt: items[0]!.updatedAt,
    participantCount: 2,
    itemCount: 2,
    groupConversationId: null,
    events: [],
    participants: [ids.self, ids.owner].map((userId) => ({
      userId,
      displayName: userId === ids.self ? 'You' : 'Alex',
      invitationStatus: 'invited',
      invitedAt: items[0]!.createdAt,
      respondedAt: null,
      acceptedAt: null,
      acceptedVersion: null,
    })),
    items: items.slice(0, 2).map((item) => ({
      id: item.id,
      listingId: item.id,
      ownerId: item.ownerId,
      recipientId: item.ownerId === ids.self ? ids.owner : ids.self,
      listingRevision: 1,
      titleSnapshot: item.title,
      descriptionSnapshot: item.description,
      conditionSnapshot: item.condition,
      currentAvailability: 'available',
    })),
  };
}

test('older revision preserves draft and compares authoritative terms without automatic resubmission', async () => {
  const latest = proposal(2);
  latest.items[0]!.descriptionSnapshot = 'A changed bicycle condition';
  latest.items[0]!.listingRevision = 2;
  latest.participants.push({
    ...latest.participants[0]!,
    userId: ids.third,
    displayName: 'Casey',
  });
  latest.participantCount = 3;
  const payloads: Record<string, unknown>[] = [];
  server.use(
    http.put('http://127.0.0.1:3001/api/v1/trades/:id', async ({ request }) => {
      payloads.push((await request.json()) as Record<string, unknown>);
      return payloads.length === 1
        ? HttpResponse.json(
            {
              error: {
                code: 'STALE_PROPOSAL',
                message: 'The proposal changed. Reload its terms.',
                requestId: 'synthetic',
              },
            },
            { status: 409 },
          )
        : HttpResponse.json({
            id: ids.bicycle,
            currentVersion: 3,
            status: 'proposed',
          });
    }),
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(latest),
    ),
  );
  const { user } = mount(proposal());
  await user.click(
    await screen.findByRole('button', { name: 'Edit proposal' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Canvas bag' }));
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await user.click(
    await screen.findByRole('button', { name: 'Save revision' }),
  );
  const conflict = await screen.findByRole('region', {
    name: 'Proposal conflict',
  });
  expect(conflict).toHaveTextContent('latest version 2');
  expect(conflict).toHaveTextContent('participant added');
  expect(conflict).toHaveTextContent('listing snapshot revised');
  expect(conflict).toHaveTextContent('A changed bicycle condition');
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  expect(payloads).toHaveLength(1);
  expect(payloads[0]!.expectedVersion).toBe(1);
  await user.click(
    within(conflict).getByRole('button', {
      name: 'Reuse draft and review latest version',
    }),
  );
  expect(
    await screen.findByRole('checkbox', { name: 'Canvas bag' }),
  ).toBeChecked();
  expect(payloads).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await user.click(
    await screen.findByRole('button', { name: 'Save revision' }),
  );
  expect(payloads).toHaveLength(2);
  expect(payloads[1]!.expectedVersion).toBe(2);
});

test('revision permits participant removal and keeps saved terms unchanged before submission', async () => {
  const saved = proposal();
  saved.participants.push({
    ...saved.participants[0]!,
    userId: ids.third,
    displayName: 'Casey',
  });
  saved.participantCount = 3;
  const { user, writes } = mount(saved);
  await user.click(
    await screen.findByRole('button', { name: 'Edit proposal' }),
  );
  await user.click(screen.getByRole('button', { name: 'Remove Casey' }));
  expect(saved.participants).toHaveLength(3);
  expect(writes()).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  expect(
    await screen.findByRole('list', { name: 'Trade transfers' }),
  ).not.toHaveTextContent('Casey');
  expect(saved.currentVersion).toBe(1);
});

test('failed authoritative refresh blocks saving until retry and frozen terms cannot reuse the draft', async () => {
  let reads = 0;
  let writes = 0;
  const frozen = { ...proposal(2), status: 'confirmed' as const };
  server.use(
    http.put('http://127.0.0.1:3001/api/v1/trades/:id', () => {
      writes++;
      return HttpResponse.json(
        {
          error: {
            code: 'TERMS_FROZEN',
            message: 'These terms cannot be revised.',
            requestId: 'synthetic',
          },
        },
        { status: 409 },
      );
    }),
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () => {
      reads++;
      return reads === 1
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json(frozen);
    }),
  );
  const { user } = mount(proposal());
  await user.click(
    await screen.findByRole('button', { name: 'Edit proposal' }),
  );
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await user.click(
    await screen.findByRole('button', { name: 'Save revision' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Latest terms could not be loaded',
  );
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  expect(writes).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Load latest terms' }));
  expect(
    await screen.findByRole('region', { name: 'Proposal conflict' }),
  ).toHaveTextContent('These terms are read-only');
  expect(
    screen.queryByRole('button', {
      name: 'Reuse draft and review latest version',
    }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  expect(writes).toBe(1);
});

test('current detail explains renewed agreement and never presents old acceptance as current consent', async () => {
  const revised = proposal(2);
  revised.participants[0]!.acceptedVersion = 1;
  revised.items[0]!.listingRevision = 2;
  revised.items[0]!.descriptionSnapshot = 'New material details';
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(revised),
    ),
    http.get('http://127.0.0.1:3001/api/v1/trades/:id/versions/:version', () =>
      HttpResponse.json({
        tradeId: ids.bicycle,
        version: 1,
        participantIds: [ids.self, ids.owner],
        expiresAt: revised.expiresAt,
        createdBy: ids.self,
        createdAt: revised.createdAt,
        items: proposal().items,
      }),
    ),
  );
  mount(undefined, true);
  expect(
    await screen.findByRole('region', { name: 'Term changes' }),
  ).toHaveTextContent('Everyone must agree to version 2');
  expect(await screen.findByText(/1 listing snapshot revised/)).toBeVisible();
  expect(screen.queryByText('Current terms accepted')).not.toBeInTheDocument();
  expect(screen.getAllByText(/Renewed agreement required/)).toHaveLength(2);
  expect(screen.getByText(/New material details/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Edit proposal' })).toBeVisible();
});

test('confirmed detail freezes the saved terms and exposes no edit control', async () => {
  const confirmed = { ...proposal(), status: 'confirmed' as const };
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(confirmed),
    ),
  );
  mount(undefined, true);
  expect(
    await screen.findByText(/Confirmed terms are read-only/),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Edit proposal' }),
  ).not.toBeInTheDocument();
});

test('unauthorized detail never exposes proposal edit controls', async () => {
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(
        {
          error: {
            code: 'TRADE_UNAVAILABLE',
            message: 'Unavailable',
            requestId: 'synthetic',
          },
        },
        { status: 404 },
      ),
    ),
  );
  mount(undefined, true);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This swap cannot be found or you do not have access.',
  );
  expect(
    screen.queryByRole('button', { name: 'Edit proposal' }),
  ).not.toBeInTheDocument();
});

test('conflict refresh updates shared detail while preserving the independent older draft', async () => {
  let authoritative = proposal();
  let writes = 0;
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(authoritative),
    ),
    http.get('http://127.0.0.1:3001/api/v1/trades/:id/versions/:version', () =>
      HttpResponse.json({
        tradeId: ids.bicycle,
        version: 1,
        participantIds: [ids.self, ids.owner],
        expiresAt: authoritative.expiresAt,
        createdBy: ids.self,
        createdAt: authoritative.createdAt,
        items: proposal().items,
      }),
    ),
    http.put('http://127.0.0.1:3001/api/v1/trades/:id', () => {
      writes++;
      authoritative = proposal(2);
      return HttpResponse.json(
        {
          error: {
            code: 'STALE_PROPOSAL',
            message: 'The proposal changed. Reload its terms.',
            requestId: 'synthetic',
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user } = mount(undefined, true);
  await user.click(
    await screen.findByRole('button', { name: 'Edit proposal' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Canvas bag' }));
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await user.click(
    await screen.findByRole('button', { name: 'Save revision' }),
  );
  expect(
    await screen.findByRole('region', { name: 'Proposal conflict' }),
  ).toHaveTextContent('latest version 2');
  await user.keyboard('{Escape}');
  expect(await screen.findByText('Proposed · Version 2')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Edit proposal' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Edit proposal' }));
  expect(
    await screen.findByRole('checkbox', { name: 'Canvas bag' }),
  ).toBeChecked();
  expect(screen.getByText(/Editing version 1/)).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Proposal conflict' }),
  ).toHaveTextContent('latest version 2');
  expect(writes).toBe(1);
});

test('a frozen authoritative response keeps the open recovery draft while shared detail becomes read-only', async () => {
  let authoritative = proposal();
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(authoritative),
    ),
    http.put('http://127.0.0.1:3001/api/v1/trades/:id', () => {
      authoritative = { ...proposal(), status: 'confirmed' };
      return HttpResponse.json(
        {
          error: {
            code: 'TERMS_FROZEN',
            message: 'These terms cannot be revised.',
            requestId: 'synthetic',
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user } = mount(undefined, true);
  await user.click(
    await screen.findByRole('button', { name: 'Edit proposal' }),
  );
  await user.click(await screen.findByRole('checkbox', { name: 'Canvas bag' }));
  await user.click(screen.getByRole('button', { name: 'Review proposal' }));
  await user.click(
    await screen.findByRole('button', { name: 'Save revision' }),
  );
  expect(
    await screen.findByRole('region', { name: 'Proposal conflict' }),
  ).toHaveTextContent('These terms are read-only');
  expect(
    screen.getByRole('list', { name: 'Trade transfers' }),
  ).toHaveTextContent('Canvas bag');
  expect(screen.getByRole('button', { name: 'Save revision' })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(await screen.findByText('Confirmed · Version 1')).toBeVisible();
  expect(screen.getByText(/Confirmed terms are read-only/)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Swap proposal' })).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: 'Edit proposal' }),
  ).not.toBeInTheDocument();
});
