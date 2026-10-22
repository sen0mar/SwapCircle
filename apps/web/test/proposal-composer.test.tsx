import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import type { Listing } from '@swapcircle/contracts';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { ProposalComposer } from '../src/features/browse/ProposalComposer';
import { TradeDetailPage } from '../src/features/trades/TradeDetailPage';
import type { TradeDetail } from '../src/features/trades/trades-api';
import { server } from './setup';

vi.mock('../src/features/browse/listing-photos', () => ({
  useListingPhotos: () => ({ data: [] }),
  ListingImage: () => null,
}));

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
    http.get('*/api/v1/trades/:id/coffee', () => HttpResponse.json([])),
    http.get('*/api/v1/trades/:id/coffee/eligibility', ({ params, request }) =>
      HttpResponse.json({
        tradeId: params.id,
        inviterId: ids.self,
        inviteeId: new URL(request.url).searchParams.get('inviteeId'),
        eligible: false,
        sharedInterests: [],
      }),
    ),
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

  return { user: userEvent.setup(), writes: () => writes, payloads, queries };
}

test('new proposals contain only a message and optional photo and preserve drafts when closed', async () => {
  const { user, writes } = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Item quality (optional)' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send proposal' })).toBeDisabled();
  await user.type(
    screen.getByRole('textbox', { name: 'Your message' }),
    'I can offer a lamp.',
  );
  await user.click(screen.getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Propose a trade' }));
  expect(screen.getByRole('textbox')).toHaveValue('I can offer a lamp.');
  expect(writes()).toBe(0);
});

test('failed message submission preserves its retry key and content', async () => {
  const payloads: unknown[] = [];
  server.use(
    http.post('*/api/v1/conversations/proposals', async ({ request }) => {
      payloads.push(await request.json());
      return new HttpResponse(null, { status: 503 });
    }),
  );
  const { user } = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.type(screen.getByRole('textbox'), 'I can offer a lamp.');
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Item quality (optional)' }),
    'good',
  );
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  await screen.findByRole('alert');
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0]).toMatchObject({
    listingId: ids.bicycle,
    body: 'I can offer a lamp.',
    condition: 'good',
  });
  expect(screen.getByRole('textbox')).toHaveValue('I can offer a lamp.');
});

test('a successful message closes the proposal dialog', async () => {
  server.use(
    http.post('*/api/v1/conversations/proposals', async ({ request }) => {
      const input = (await request.json()) as {
        body: string;
        clientMessageId: string;
      };
      return HttpResponse.json({
        id: ids.lamp,
        conversation_id: ids.bicycle,
        sender_id: ids.self,
        body: input.body,
        client_message_id: input.clientMessageId,
        has_photo: false,
        message_order: 1,
        created_at: items[0]!.createdAt,
      });
    }),
  );
  const { user } = mount();
  await user.click(
    await screen.findByRole('button', { name: 'Propose a trade' }),
  );
  await user.type(screen.getByRole('textbox'), 'I can offer a lamp.');
  await user.click(screen.getByRole('button', { name: 'Send proposal' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    hasUnavailableItems: false,
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
  );
  const { user } = mount(undefined, true);
  await user.click(
    await screen.findByRole('button', { name: 'Review current terms' }),
  );
  expect(
    await screen.findByRole('region', { name: 'Acceptance review' }),
  ).toHaveTextContent('Review version 2');
  expect(screen.getByText(/New material details/)).toBeVisible();
  expect(
    screen.queryByText('Your acceptance is saved.', { exact: true }),
  ).not.toBeInTheDocument();
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
  expect(await screen.findByRole('heading', { name: 'Your swap' })).toHaveClass(
    'sr-only',
  );
  expect(
    screen.queryByText('Agreed. Arrange your meetup.'),
  ).not.toBeInTheDocument();
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
  expect(await screen.findByRole('heading', { name: 'Your swap' })).toHaveClass(
    'sr-only',
  );
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
  expect(await screen.findByRole('heading', { name: 'Your swap' })).toHaveClass(
    'sr-only',
  );
  expect(
    screen.queryByText('Agreed. Arrange your meetup.'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit proposal' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Your swap' })).toHaveFocus();
  expect(
    screen.queryByRole('button', { name: 'Edit proposal' }),
  ).not.toBeInTheDocument();
});

test('acceptance requires explicit refreshed review, preserves key on failure and never optimistically confirms', async () => {
  let saved = proposal();
  const payloads: { expectedVersion: number; operationKey: string }[] = [];
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(saved),
    ),
    http.post(
      'http://127.0.0.1:3001/api/v1/trades/:id/accept',
      async ({ request }) => {
        payloads.push((await request.json()) as (typeof payloads)[number]);
        if (payloads.length === 1)
          return new HttpResponse(null, { status: 503 });
        saved = {
          ...saved,
          participants: saved.participants.map((p) =>
            p.userId === ids.self ? { ...p, acceptedVersion: 1 } : p,
          ),
        };
        return HttpResponse.json({
          id: saved.id,
          acceptedVersion: 1,
          status: 'proposed',
        });
      },
    ),
  );
  const { user, queries } = mount(undefined, true);
  const refreshedKeys = [
    ['private', ids.self, 'my-trades'],
    ['private', ids.self, 'my-listings'],
    ['listing', ids.lamp],
    ['listings', { availability: 'available' }],
    ['proposal-items', ids.self],
  ];
  await screen.findByRole('heading', { name: 'Accept this swap' });
  for (const key of refreshedKeys)
    queries.setQueryData(key, { synthetic: true });
  expect(
    screen.queryByRole('button', { name: 'Accept version 1' }),
  ).not.toBeInTheDocument();
  expect(payloads).toHaveLength(0);
  await user.click(
    screen.getByRole('button', { name: 'Review current terms' }),
  );
  const review = await screen.findByRole('region', {
    name: 'Acceptance review',
  });
  expect(review).toHaveTextContent('Desk lamp to Alex');
  expect(review).toHaveTextContent('Bicycle from Alex');
  await user.click(screen.getByRole('button', { name: 'Accept version 1' }));
  expect(
    await screen.findByText(/Acceptance could not be verified/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Accept version 1' }));
  await screen.findByText(/Your acceptance is saved/);
  expect(
    screen.getByRole('heading', { name: 'Accept this swap' }),
  ).toHaveFocus();
  expect(payloads[0]).toEqual(payloads[1]);
  for (const key of refreshedKeys)
    expect(queries.getQueryState(key)?.isInvalidated).toBe(true);
  expect(screen.queryByText('Agreement confirmed')).not.toBeInTheDocument();
});

test('stale acceptance retains old terms and requires a deliberate review of the new version', async () => {
  let saved = proposal();
  let writes = 0;
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(saved),
    ),
    http.post('http://127.0.0.1:3001/api/v1/trades/:id/accept', () => {
      writes++;
      saved = proposal(2);
      saved.items[0]!.titleSnapshot = 'Changed bicycle';
      return HttpResponse.json(
        {
          error: {
            code: 'STALE_PROPOSAL',
            message: 'Reload terms.',
            requestId: 'synthetic',
          },
        },
        { status: 409 },
      );
    }),
  );
  const { user } = mount(undefined, true);
  await user.click(
    await screen.findByRole('button', { name: 'Review current terms' }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Accept version 1' }),
  );
  await screen.findByText(/You reviewed version 1/);
  expect(
    screen.getByRole('button', { name: 'Accept version 1' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('region', { name: 'Acceptance review' }),
  ).toHaveTextContent('Bicycle from Alex');
  expect(writes).toBe(1);
  await user.click(
    screen.getByRole('button', { name: 'Review current terms' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Accept version 2' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('region', { name: 'Acceptance review' }),
  ).toHaveTextContent('Changed bicycle');
  expect(writes).toBe(1);
});

test('confirmed reservations represent agreement without reporting its own items as unavailable', async () => {
  const saved = { ...proposal(), status: 'confirmed' as TradeDetail['status'] };
  saved.items.forEach((item) => {
    item.currentAvailability = 'reserved';
  });
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      HttpResponse.json(saved),
    ),
  );
  mount(undefined, true);
  expect(await screen.findByRole('heading', { name: 'Your swap' })).toHaveClass(
    'sr-only',
  );
  expect(
    screen.queryByText('Agreed. Arrange your meetup.'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Swap status' })).toHaveTextContent(
    'Confirmed',
  );
  expect(
    screen.queryByText(/proposed items are no longer/),
  ).not.toBeInTheDocument();
});

test('failed current-term refresh keeps the reviewed context and blocks acceptance until fresh review', async () => {
  let failRead = false;
  server.use(
    http.get('http://127.0.0.1:3001/api/v1/trades/:id', () =>
      failRead
        ? new HttpResponse(null, { status: 503 })
        : HttpResponse.json(proposal()),
    ),
  );
  const { user } = mount(undefined, true);
  await user.click(
    await screen.findByRole('button', { name: 'Review current terms' }),
  );
  await screen.findByRole('button', { name: 'Accept version 1' });
  failRead = true;
  await user.click(
    screen.getByRole('button', { name: 'Review current terms' }),
  );
  await screen.findByText(/Current terms could not be refreshed/);
  expect(
    screen.getByRole('region', { name: 'Acceptance review' }),
  ).toHaveTextContent('Desk lamp to Alex');
  expect(
    screen.getByRole('button', { name: 'Accept version 1' }),
  ).toBeDisabled();
  failRead = false;
  await user.click(
    screen.getByRole('button', { name: 'Review current terms' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Accept version 1' }),
  ).toBeEnabled();
});
