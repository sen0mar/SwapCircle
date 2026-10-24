import { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  CalendarDays,
  Check,
  ChevronRight,
  History,
  Package,
} from 'lucide-react';
import type { z } from 'zod';
import type {
  AcceptedProposalPage,
  tradeSummarySchema,
} from '@swapcircle/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import {
  useAcceptedProposals,
  useConfirmReceipt,
  useSwapSchedule,
} from './useTrades';
import { ListingImage, useListingPhotos } from '../browse/listing-photos';

type Swap = z.infer<typeof tradeSummarySchema>;

function DateBadge({ meeting, id }: { meeting: Swap['meeting']; id?: string }) {
  if (!meeting)
    return (
      <span className="schedule-date schedule-date-unset" aria-hidden="true">
        <CalendarDays size={24} />
        <span>To plan</span>
      </span>
    );
  const date = new Date(meeting.meetingAt);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: meeting.timeZone,
    }).format(date);

  return (
    <time
      className="schedule-date"
      dateTime={meeting.meetingAt}
      aria-label={format({ dateStyle: 'full' })}
    >
      <span>{format({ month: 'short' })}</span>
      <strong>{format({ day: 'numeric' })}</strong>
      <span>{format({ weekday: 'short' })}</span>
      <span className="sr-only" id={id}>
        {format({ dateStyle: 'full' })}
      </span>
    </time>
  );
}

function ItemPreview({
  item,
  direction,
}: {
  item: Swap['itemPreviews'][number] | undefined;
  direction: string;
}) {
  const photos = useListingPhotos(item?.listingId ?? '');

  return (
    <div className="schedule-item">
      <div className="schedule-item-photo">
        {item && photos.data?.[0] ? (
          <ListingImage photo={photos.data[0]} title={item.title} />
        ) : (
          <Package size={28} aria-hidden="true" />
        )}
      </div>
      <div>
        <span>{direction}</span>
        <strong>{item?.title ?? 'See swap details'}</strong>
      </div>
    </div>
  );
}

function ScheduleCard({
  trade,
  now,
  completed = false,
}: {
  trade: Swap;
  now: number;
  completed?: boolean;
}) {
  const { session } = useAuth();
  const receipt = useConfirmReceipt(trade.id);
  const [operationKey, setOperationKey] = useState<string>();
  const pastDue = !!trade.meeting && Date.parse(trade.meeting.meetingAt) <= now;
  const title =
    trade.itemPreviews.map((item) => item.title).join(' ↔ ') || 'Item swap';
  const give = trade.itemPreviews.find(
    (item) => item.ownerId === session?.user.id,
  );
  const receive = trade.itemPreviews.find(
    (item) => item.recipientId === session?.user.id,
  );
  const otherName = give?.recipientName ?? receive?.ownerName;
  const status = completed
    ? 'Completed'
    : pastDue
      ? 'Confirm completion'
      : trade.meeting
        ? 'Scheduled'
        : 'Date to arrange';
  const shownCount = Number(!!give) + Number(!!receive);

  function confirm() {
    const key = operationKey ?? crypto.randomUUID();
    setOperationKey(key);
    receipt.mutate({
      operationKey: key,
      expectedVersion: trade.currentVersion,
    });
  }

  return (
    <Card
      className="schedule-card"
      data-state={completed ? 'completed' : pastDue ? 'due' : 'upcoming'}
    >
      <Link
        className="schedule-card-link"
        to={`/swaps/${trade.id}`}
        aria-label={`View swap: ${title}`}
        aria-describedby={
          trade.meeting
            ? `swap-date-${encodeURIComponent(trade.id)}`
            : undefined
        }
      >
        <DateBadge
          meeting={trade.meeting}
          id={`swap-date-${encodeURIComponent(trade.id)}`}
        />
        <div className="schedule-card-copy">
          <div className="schedule-card-topline">
            <h3>{otherName ? `With ${otherName}` : 'Item swap'}</h3>
            <span className="schedule-status">
              {completed && <Check size={14} aria-hidden="true" />}
              {status}
            </span>
          </div>
          <div className="schedule-exchange">
            <ItemPreview item={give} direction="You give" />
            <ArrowRightLeft
              className="schedule-exchange-arrow"
              size={20}
              aria-hidden="true"
            />
            <ItemPreview item={receive} direction="You receive" />
          </div>
          {trade.itemCount > shownCount && (
            <p className="schedule-more">
              +{trade.itemCount - shownCount} more{' '}
              {trade.itemCount - shownCount === 1 ? 'item' : 'items'} in this
              swap
            </p>
          )}
          <div className="schedule-card-meta">
            <span className="schedule-open">
              View details <ChevronRight size={16} aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
      {!completed && pastDue && (
        <div className="schedule-card-action">
          <Button
            variant="primary"
            onClick={confirm}
            disabled={receipt.isPending}
          >
            <Check size={16} aria-hidden="true" />
            {receipt.isPending ? 'Confirming…' : 'Confirm swap completed'}
          </Button>
          {receipt.isError && (
            <p role="alert">Could not confirm completion. Please try again.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function OfferReminder({
  offer,
  userId,
}: {
  offer: AcceptedProposalPage['items'][number];
  userId: string | undefined;
}) {
  const proposal = offer.message.proposal;
  const photos = useListingPhotos(proposal?.listingId ?? '');
  const otherName =
    offer.message.sender_id === userId ? offer.recipientName : offer.senderName;

  return (
    <Card className="schedule-card">
      <Link
        className="schedule-card-link"
        to={`/inbox/${offer.message.conversation_id}`}
        aria-label={`Open swap conversation: ${proposal?.listingTitle ?? 'Accepted offer'}`}
      >
        <DateBadge meeting={null} />
        <div className="schedule-card-copy">
          <div className="schedule-card-topline">
            <h3>With {otherName}</h3>
            <span className="schedule-status">Accepted offer</span>
          </div>
          <div className="schedule-item schedule-offer-item">
            <div className="schedule-item-photo">
              {photos.data?.[0] && proposal ? (
                <ListingImage
                  photo={photos.data[0]}
                  title={proposal.listingTitle}
                />
              ) : (
                <Package size={28} aria-hidden="true" />
              )}
            </div>
            <div>
              <span>Item to swap</span>
              <strong>{proposal?.listingTitle ?? 'Accepted offer'}</strong>
            </div>
          </div>
          <div className="schedule-card-meta">
            <span className="schedule-open">
              Open conversation <ChevronRight size={16} aria-hidden="true" />
            </span>
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function MySwapsPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('view') === 'history' ? 'history' : 'upcoming';

  function selectTab(tab: 'upcoming' | 'history') {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', tab);
      return next;
    });
  }

  const trades = useSwapSchedule();
  const accepted = useAcceptedProposals();
  const { session } = useAuth();
  const offers = accepted.data?.pages.flatMap((page) => page.items) ?? [];
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = trades.data?.pages.flatMap((page) => page.items) ?? [];
  const upcoming = items
    .filter(
      (trade) =>
        trade.status === 'confirmed' &&
        !trade.receiptUserIds.includes(session?.user.id ?? ''),
    )
    .sort(
      (a, b) =>
        (a.meeting ? Date.parse(a.meeting.meetingAt) : Infinity) -
        (b.meeting ? Date.parse(b.meeting.meetingAt) : Infinity),
    );
  const history = items
    .filter(
      (trade) =>
        trade.status === 'completed' ||
        (trade.status === 'confirmed' &&
          trade.receiptUserIds.includes(session?.user.id ?? '')),
    )
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  return (
    <section className="swaps-page swap-schedule" aria-label="My Swaps">
      <h1 className="sr-only">My Swaps</h1>
      {trades.isPending ? (
        <p role="status">Loading your swaps…</p>
      ) : trades.isError ? (
        <div className="panel route-panel">
          <p role="alert">Your swaps could not be loaded.</p>
          <Button onClick={() => void trades.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          <div
            className="schedule-navigation"
            role="tablist"
            aria-label="Swap views"
          >
            {(['upcoming', 'history'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`swaps-${tab}-tab`}
                aria-controls={`swaps-${tab}-panel`}
                aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => {
                  if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  const nextTab =
                    event.key === 'Home'
                      ? 'upcoming'
                      : event.key === 'End'
                        ? 'history'
                        : tab === 'upcoming'
                          ? 'history'
                          : 'upcoming';
                  selectTab(nextTab);
                  event.currentTarget.ownerDocument
                    .getElementById(`swaps-${nextTab}-tab`)
                    ?.focus();
                }}
              >
                {tab === 'upcoming' ? (
                  <CalendarDays size={18} aria-hidden="true" />
                ) : (
                  <History size={18} aria-hidden="true" />
                )}
                {tab === 'upcoming' ? 'Upcoming swaps' : 'Swap history'}
              </button>
            ))}
          </div>
          <section
            className="schedule-tab-panel"
            id="swaps-upcoming-panel"
            role="tabpanel"
            aria-labelledby="swaps-upcoming-tab"
            tabIndex={0}
            hidden={activeTab !== 'upcoming'}
          >
            <h2 className="sr-only">Upcoming swaps</h2>
            {upcoming.length || offers.length ? (
              <div className="schedule-list">
                {[
                  {
                    label: 'Ready to complete',
                    items: upcoming.filter(
                      (trade) =>
                        trade.meeting &&
                        Date.parse(trade.meeting.meetingAt) <= now,
                    ),
                  },
                  {
                    label: 'Coming up',
                    items: upcoming.filter(
                      (trade) =>
                        trade.meeting &&
                        Date.parse(trade.meeting.meetingAt) > now,
                    ),
                  },
                  {
                    label: 'To arrange',
                    items: upcoming.filter((trade) => !trade.meeting),
                  },
                ].map(
                  (group) =>
                    (group.items.length > 0 ||
                      (group.label === 'To arrange' && offers.length > 0)) && (
                      <div className="schedule-group" key={group.label}>
                        <h3 className="schedule-group-title">{group.label}</h3>
                        {group.items.map((trade) => (
                          <ScheduleCard
                            key={trade.id}
                            trade={trade}
                            now={now}
                          />
                        ))}
                        {group.label === 'To arrange' &&
                          offers.map((offer) => (
                            <OfferReminder
                              key={offer.message.id}
                              offer={offer}
                              userId={session?.user.id}
                            />
                          ))}
                      </div>
                    ),
                )}
              </div>
            ) : (
              <div className="schedule-empty">
                <CalendarDays size={32} aria-hidden="true" />
                <h3>No upcoming swaps</h3>
                <p>
                  Accepted swaps will appear here when both people confirm the
                  trade.
                </p>
              </div>
            )}
            {accepted.isPending && (
              <p role="status">Loading accepted offers…</p>
            )}
            {accepted.isError && (
              <div>
                <p role="alert">Accepted offers could not be loaded.</p>
                <Button onClick={() => void accepted.refetch()}>
                  Retry accepted offers
                </Button>
              </div>
            )}
            {accepted.hasNextPage && (
              <Button
                variant="secondary"
                disabled={accepted.isFetchingNextPage}
                onClick={() => void accepted.fetchNextPage()}
              >
                Load more accepted offers
              </Button>
            )}
          </section>
          <section
            className="schedule-tab-panel"
            id="swaps-history-panel"
            role="tabpanel"
            aria-labelledby="swaps-history-tab"
            tabIndex={0}
            hidden={activeTab !== 'history'}
          >
            <h2 className="sr-only">Swap history</h2>
            {history.length ? (
              <div className="schedule-list">
                {history.map((trade) => (
                  <ScheduleCard
                    key={trade.id}
                    trade={trade}
                    now={now}
                    completed
                  />
                ))}
              </div>
            ) : (
              <div className="schedule-empty">
                <History size={32} aria-hidden="true" />
                <h3>No completed swaps yet</h3>
                <p>
                  Confirm a swap in Upcoming swaps to add it here, even after
                  its meeting date.
                </p>
              </div>
            )}
          </section>
          {trades.hasNextPage && (
            <Button
              variant="secondary"
              disabled={trades.isFetchingNextPage}
              onClick={() => void trades.fetchNextPage()}
            >
              {trades.isFetchingNextPage ? 'Loading…' : 'Load more swaps'}
            </Button>
          )}
          {trades.isFetchNextPageError && (
            <p role="alert">
              More swaps could not be loaded. Please try again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
