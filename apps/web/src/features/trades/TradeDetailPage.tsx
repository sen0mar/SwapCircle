import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { useTrade } from './useTrades';

const statuses: Record<string, string> = {
  proposed: 'Proposed',
  confirmed: 'Confirmed',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};
const invitations: Record<string, string> = {
  invited: 'Invited · response pending',
  joined: 'Joined',
  declined: 'Declined',
};

export function TradeDetailPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const trade = useTrade(id);

  if (trade.isPending)
    return (
      <section className="panel route-panel">
        <p role="status">Loading swap…</p>
      </section>
    );
  if (trade.isError) {
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
  const gives = trade.data.items.filter(
    (item) => item.ownerId === session?.user.id,
  );
  const receives = trade.data.items.filter(
    (item) => item.recipientId === session?.user.id,
  );
  const withdrawn = trade.data.items.filter(
    (item) => item.currentAvailability !== 'available',
  );

  return (
    <article className="trade-detail" aria-labelledby="trade-title">
      <Link to="/swaps">← My Swaps</Link>
      <div className="section-heading">
        <div>
          <h1 id="trade-title">Swap proposal</h1>
          <p>
            {statuses[trade.data.status]} · Version {trade.data.currentVersion}
          </p>
        </div>
      </div>
      <div className="panel route-panel">
        <h2>Current terms</h2>
        <p>
          Meet to swap · {trade.data.participantCount} people ·{' '}
          {trade.data.itemCount} items
        </p>
        <p>
          Expires{' '}
          <time dateTime={trade.data.expiresAt}>
            {new Date(trade.data.expiresAt).toLocaleString()}
          </time>
        </p>
        {trade.data.status === 'proposed' && (
          <p>
            This is a proposal. Items are not reserved, and opening this page
            does not accept the invitation or terms.
          </p>
        )}
        {self?.invitationStatus === 'invited' && (
          <p role="status">
            Your invitation is pending. Response controls are not available yet.
          </p>
        )}
        {withdrawn.length > 0 && (
          <p role="alert">
            {withdrawn.length} proposed{' '}
            {withdrawn.length === 1 ? 'item is' : 'items are'} no longer
            available. Review current availability before any later
            confirmation.
          </p>
        )}
      </div>
      <div className="trade-detail-grid">
        <section className="panel route-panel">
          <h2>You give</h2>
          {gives.length ? (
            <ul>
              {gives.map((item) => (
                <li key={item.id}>
                  {item.titleSnapshot} to{' '}
                  {names.get(item.recipientId) ?? 'Member'}
                  {item.currentAvailability !== 'available'
                    ? ` · ${item.currentAvailability ?? 'Unavailable'}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No items from you in these terms.</p>
          )}
        </section>
        <section className="panel route-panel">
          <h2>You receive</h2>
          {receives.length ? (
            <ul>
              {receives.map((item) => (
                <li key={item.id}>
                  {item.titleSnapshot} from{' '}
                  {names.get(item.ownerId) ?? 'Member'}
                  {item.currentAvailability !== 'available'
                    ? ` · ${item.currentAvailability ?? 'Unavailable'}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p>No items for you in these terms.</p>
          )}
        </section>
      </div>
      <section className="panel route-panel">
        <h2>All item transfers</h2>
        <ul>
          {trade.data.items.map((item) => (
            <li key={item.id}>
              {names.get(item.ownerId) ?? 'Member'} gives {item.titleSnapshot}{' '}
              to {names.get(item.recipientId) ?? 'Member'} ·{' '}
              {item.currentAvailability ?? 'Unavailable'}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel route-panel">
        <h2>Participants</h2>
        <ul>
          {trade.data.participants.map((person) => (
            <li key={person.userId}>
              {person.displayName}
              {person.userId === session?.user.id ? ' (you)' : ''} ·{' '}
              {invitations[person.invitationStatus]}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel route-panel">
        <h2>History</h2>
        <ol>
          {trade.data.events.map((event) => (
            <li key={event.id}>
              {statuses[event.eventType] ?? event.eventType} by{' '}
              {names.get(event.actorId) ?? 'Member'} · version {event.version} ·{' '}
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
