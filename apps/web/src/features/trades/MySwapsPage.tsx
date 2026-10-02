import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { useMyTrades } from './useTrades';
import { lifecycleSummary } from './lifecycle-copy';

const statuses: Record<string, string> = {
  proposed: 'Proposed · awaiting responses',
  confirmed: 'Confirmed · agreement reached',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

export function MySwapsPage() {
  const [params] = useSearchParams();
  const after = params.get('after') ?? '';
  const trades = useMyTrades(after);

  return (
    <section className="swaps-page" aria-labelledby="swaps-title">
      <div className="section-heading">
        <div>
          <h1 id="swaps-title">My Swaps</h1>
          <p>Proposals and swaps you participate in.</p>
        </div>
      </div>
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
                <h2>Swap proposal</h2>
                <p>
                  {statuses[trade.status]} · {trade.participantCount} people ·{' '}
                  {trade.itemCount} items
                </p>
                <p>
                  Expires{' '}
                  <time dateTime={trade.expiresAt}>
                    {new Date(trade.expiresAt).toLocaleString()}
                  </time>
                </p>
                {trade.status === 'confirmed' && (
                  <p>Items reserved · handover not yet confirmed.</p>
                )}
                {trade.status === 'proposed' && <p>Items are not reserved.</p>}
                {trade.status === 'proposed' && trade.hasUnavailableItems && (
                  <p>
                    An item is no longer available. This proposal cannot confirm
                    with these items.
                  </p>
                )}
                {lifecycleSummary(trade.status) && (
                  <p>{lifecycleSummary(trade.status)}</p>
                )}
                <Link to={`/swaps/${trade.id}`}>View swap</Link>
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
