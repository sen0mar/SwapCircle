import { ArrowRight, ArrowRightLeft, Users, Package } from 'lucide-react';
import type { z } from 'zod';
import type { tradeSummarySchema } from '@swapcircle/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ListingImage, useListingPhotos } from '../browse/listing-photos';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useMyTrades } from './useTrades';
import { lifecycleSummary } from './lifecycle-copy';

type ItemPreview = z.infer<typeof tradeSummarySchema>['itemPreviews'][number];

function SwapItem({
  item,
  userId,
}: {
  item: ItemPreview;
  userId: string | undefined;
}) {
  const photos = useListingPhotos(item.listingId);
  const direction =
    item.ownerId === userId
      ? 'You give'
      : item.recipientId === userId
        ? 'You receive'
        : 'In this swap';

  return (
    <li className="swap-item">
      <div className="swap-item-photo">
        <ListingImage photo={photos.data?.[0]} title={item.title} />
      </div>
      <div className="swap-item-copy">
        <span className="swap-item-direction">{direction}</span>
        <h3>{item.title}</h3>
        <p>
          {item.ownerId === userId ? 'You' : item.ownerName} →{' '}
          {item.recipientId === userId ? 'you' : item.recipientName}
        </p>
      </div>
    </li>
  );
}

export function MySwapsPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const after = params.get('after') ?? '';
  const trades = useMyTrades(after);

  return (
    <section className="swaps-page" aria-label="My Swaps">
      {trades.isPending ? (
        <p role="status">Loading your swaps…</p>
      ) : trades.isError ? (
        <div className="panel route-panel">
          <p role="alert">Your swaps could not be loaded.</p>
          <Button onClick={() => void trades.refetch()}>Retry</Button>
        </div>
      ) : trades.data.items.length === 0 ? (
        <div className="panel route-panel">
          <h2>No swaps yet</h2>
          <p>Propose a trade from an available item in Browse.</p>
          <Link to="/browse">Browse items</Link>
        </div>
      ) : (
        <>
          <div className="swaps-grid">
            {trades.data.items.map((trade) => (
              <Card key={trade.id} className="swap-card">
                <div className="swap-card-header">
                  <div className="swap-card-label">
                    <ArrowRightLeft size={20} aria-hidden="true" />
                    <h2>
                      {trade.participantCount > 2 ? 'Group swap' : 'Item swap'}
                    </h2>
                  </div>
                  <span className={`swap-status swap-status-${trade.status}`}>
                    {trade.status.charAt(0).toUpperCase() +
                      trade.status.slice(1)}
                  </span>
                </div>
                <p className="swap-card-meta">
                  <span>
                    <Users size={16} aria-hidden="true" />
                    {trade.participantCount} people
                  </span>
                  <span>
                    <Package size={16} aria-hidden="true" />
                    {trade.itemCount} {trade.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </p>
                {trade.itemPreviews.length > 0 && (
                  <ul className="swap-items">
                    {trade.itemPreviews.map((item) => (
                      <SwapItem
                        key={item.listingId}
                        item={item}
                        userId={session?.user.id}
                      />
                    ))}
                  </ul>
                )}
                {trade.itemCount > trade.itemPreviews.length &&
                  trade.itemPreviews.length > 0 && (
                    <p className="swap-more">
                      +{trade.itemCount - trade.itemPreviews.length} more items
                      · View the full swap
                    </p>
                  )}
                <div className="swap-card-footer">
                  {trade.status === 'proposed' && (
                    <p className="swap-expiry">
                      Respond before{' '}
                      <time dateTime={trade.expiresAt}>
                        {new Date(trade.expiresAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </p>
                  )}
                  {trade.status === 'confirmed' && (
                    <p>Items reserved for this swap.</p>
                  )}
                  {trade.status === 'proposed' && (
                    <p>Items are not reserved.</p>
                  )}
                  {trade.status === 'proposed' && trade.hasUnavailableItems && (
                    <p>
                      An item is no longer available. This proposal cannot
                      confirm with these items.
                    </p>
                  )}
                  {lifecycleSummary(trade.status) && (
                    <p>{lifecycleSummary(trade.status)}</p>
                  )}
                  <Button asChild>
                    <Link
                      to={`/swaps/${trade.id}`}
                      aria-label={`View swap${trade.itemPreviews.length ? `: ${trade.itemPreviews.map((item) => item.title).join(', ')}` : ''}`}
                    >
                      View swap
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          <nav className="catalog-pagination" aria-label="My Swaps pages">
            {after && <Link to="/swaps">First page</Link>}
            {trades.data.nextAfter && (
              <Link
                to={`/swaps?${new URLSearchParams({ after: trades.data.nextAfter })}`}
              >
                Next page
              </Link>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
