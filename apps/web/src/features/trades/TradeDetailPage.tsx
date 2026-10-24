import { ArrowRightLeft } from 'lucide-react';
import { ListingImage, useListingPhotos } from '../browse/listing-photos';
import type { TradeDetail } from './trades-api';
import { useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { MeetingReminder } from './MeetingReminder';
import { MessageAction } from '../inbox/MessageAction';
import { TradeCoffee } from './TradeCoffee';
import { TradeAcceptance } from './TradeAcceptance';
import { TradeProblem } from './TradeProblem';
import { TradeLifecycle } from './TradeLifecycle';
import { useTrade } from './useTrades';

import { ProposalComposer } from '../browse/ProposalComposer';

function SwapDetailItem({
  item,
  transfer,
}: {
  item: TradeDetail['items'][number];
  transfer: string;
}) {
  const photos = useListingPhotos(item.listingId);

  return (
    <li className="swap-detail-item">
      <div className="swap-detail-photo">
        <ListingImage photo={photos.data?.[0]} title={item.titleSnapshot} />
      </div>
      <div>
        <h3>{item.titleSnapshot}</h3>
        <p>{transfer}</p>
        <span className="swap-detail-condition">
          {item.conditionSnapshot.replaceAll('_', ' ')}
        </span>
      </div>
    </li>
  );
}

export function TradeDetailPage() {
  const heading = useRef<HTMLHeadingElement>(null);
  const { id = '' } = useParams();
  const { hash } = useLocation();
  const { session } = useAuth();
  const trade = useTrade(id);

  if (trade.isPending)
    return (
      <section className="panel route-panel">
        <p role="status">Loading swap…</p>
      </section>
    );
  if (
    trade.isError &&
    (!trade.data ||
      (trade.error instanceof ApiError &&
        [403, 404].includes(trade.error.status ?? 0)))
  ) {
    const unavailable =
      trade.error instanceof ApiError &&
      [403, 404].includes(trade.error.status ?? 0);
    return (
      <section className="panel route-panel">
        <h1>Swap unavailable</h1>
        <p role="alert">
          {unavailable
            ? 'This swap cannot be found or you do not have access.'
            : 'The swap could not be loaded.'}
        </p>
        {!unavailable && (
          <Button onClick={() => void trade.refetch()}>Retry</Button>
        )}
        <p>
          <Link to="/swaps">Back to My Swaps</Link>
        </p>
      </section>
    );
  }

  const names = new Map(
    trade.data.participants.map((person) => [
      person.userId,
      person.displayName,
    ]),
  );
  const self = trade.data.participants.find(
    (person) => person.userId === session?.user.id,
  );
  const reminderOnly = trade.data.status !== 'proposed';
  const peer = trade.data.participants.find(
    (person) => person.userId !== session?.user.id,
  );
  const gives = trade.data.items.filter(
    (item) => item.ownerId === session?.user.id,
  );
  const receives = trade.data.items.filter(
    (item) => item.recipientId === session?.user.id,
  );

  return (
    <article
      className={`trade-detail${reminderOnly ? ' trade-reminder' : ''}`}
      aria-labelledby="trade-title"
    >
      <header className="swap-reminder-topbar">
        <Link
          to={
            trade.data.status === 'completed' ? '/swaps?view=history' : '/swaps'
          }
        >
          ← My Swaps
        </Link>
        <p
          role="status"
          aria-label="Swap status"
          className={`swap-status swap-status-${trade.data.status}`}
        >
          {trade.data.status.charAt(0).toUpperCase() +
            trade.data.status.slice(1)}
        </p>
      </header>
      {trade.isError && (
        <div role="alert">
          Current agreement could not be refreshed. These are the last loaded
          details.
          <Button onClick={() => void trade.refetch()}>
            Retry current agreement
          </Button>
        </div>
      )}
      <h1 ref={heading} tabIndex={-1} id="trade-title" className="sr-only">
        Your swap
      </h1>
      {self && reminderOnly && (
        <MeetingReminder
          key={`meeting:${session?.user.id}:${id}`}
          tradeId={id}
        />
      )}
      <section className="panel swap-overview" aria-label="Items in this swap">
        <div className="trade-detail-grid">
          {[
            { title: 'You give', items: gives, giving: true },
            { title: 'You receive', items: receives, giving: false },
          ].map(({ title, items, giving }) => (
            <section key={title}>
              <h2>
                <ArrowRightLeft size={20} aria-hidden="true" />
                {title}
              </h2>
              {items.length ? (
                <ul className="swap-detail-items">
                  {items.map((item) => (
                    <SwapDetailItem
                      key={item.id}
                      item={item}
                      transfer={`${giving ? 'To' : 'From'} ${names.get(giving ? item.recipientId : item.ownerId) ?? 'Member'}`}
                    />
                  ))}
                </ul>
              ) : (
                <p>No items {giving ? 'from' : 'for'} you in this swap.</p>
              )}
            </section>
          ))}
        </div>
      </section>
      {self && (
        <div className="swap-inline-actions">
          <ProposalComposer
            key={`${session?.user.id}:${id}`}
            revision={trade.data}
            onReadOnlyClose={() => heading.current?.focus()}
          />
          {!reminderOnly && (
            <TradeLifecycle
              key={`lifecycle:${session?.user.id}:${id}`}
              detail={trade.data}
              current={!trade.isError}
            />
          )}
        </div>
      )}
      {!reminderOnly && (
        <TradeAcceptance
          key={`acceptance:${session?.user.id}:${id}`}
          detail={trade.data}
        />
      )}
      {self && reminderOnly && peer && (
        <div className="swap-reminder-contact">
          <span>With {peer.displayName}</span>
          <MessageAction userId={peer.userId} />
        </div>
      )}
      {self && !reminderOnly && (
        <details
          className="panel swap-disclosure"
          open={hash === '#coffee' || undefined}
        >
          <summary>Swap + coffee</summary>
          <TradeCoffee
            key={`coffee:${session?.user.id}:${id}`}
            detail={trade.data}
          />
        </details>
      )}
      {self && !reminderOnly && (
        <TradeProblem
          key={`problem:${session?.user.id}:${id}`}
          detail={trade.data}
          current={!trade.isError}
        />
      )}
    </article>
  );
}
