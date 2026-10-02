import { useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { GroupInvitation } from '../groups/GroupInvitation';
import { TradeMeeting } from './TradeMeeting';
import { TradeCoffee } from './TradeCoffee';
import { TradeAcceptance } from './TradeAcceptance';
import { TradeCompletion } from './TradeCompletion';
import { TradeLifecycle } from './TradeLifecycle';
import { useTrade, useTradeVersion } from './useTrades';

import { ProposalComposer } from '../browse/ProposalComposer';
import { detailTerms, termChanges } from './term-changes';

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
  const heading = useRef<HTMLHeadingElement>(null);
  const { id = '' } = useParams();
  const { session } = useAuth();
  const trade = useTrade(id);
  const previous = useTradeVersion(id, (trade.data?.currentVersion ?? 1) - 1);

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
  const gives = trade.data.items.filter(
    (item) => item.ownerId === session?.user.id,
  );
  const receives = trade.data.items.filter(
    (item) => item.recipientId === session?.user.id,
  );
  const withdrawn = trade.data.items.filter(
    (item) =>
      trade.data.status === 'proposed' &&
      item.currentAvailability !== 'available',
  );

  return (
    <article className="trade-detail" aria-labelledby="trade-title">
      <Link to="/swaps">← My Swaps</Link>
      {trade.isError && (
        <div role="alert">
          Current agreement could not be refreshed. These are the last loaded
          terms; refresh before accepting.
          <Button onClick={() => void trade.refetch()}>
            Retry current agreement
          </Button>
        </div>
      )}
      <div className="section-heading">
        <div>
          <h1 ref={heading} tabIndex={-1} id="trade-title">
            Swap proposal
          </h1>
          <p>
            {statuses[trade.data.status]} · Version {trade.data.currentVersion}
          </p>
        </div>
      </div>
      {self && (
        <TradeLifecycle
          key={`lifecycle:${session?.user.id}:${id}`}
          detail={trade.data}
          current={!trade.isError}
        />
      )}
      {self && (
        <TradeCompletion
          key={`outcomes:${session?.user.id}:${id}`}
          detail={trade.data}
          current={!trade.isError}
        />
      )}
      {self && (
        <ProposalComposer
          key={`${session?.user.id}:${id}`}
          revision={trade.data}
          onReadOnlyClose={() => heading.current?.focus()}
        />
      )}
      <div className="panel route-panel">
        <h2>Current terms</h2>
        {trade.data.currentVersion > 1 && (
          <section aria-label="Term changes">
            <h3>What changed</h3>
            {previous.data ? (
              <p>
                {termChanges(previous.data, detailTerms(trade.data)).join(
                  ' · ',
                ) || 'A new version was saved with the same visible terms.'}
              </p>
            ) : (
              <p>
                {previous.isPending
                  ? 'Loading previous terms…'
                  : 'Previous terms are unavailable to this account. Review the complete current version below.'}
              </p>
            )}
            {previous.isError && (
              <Button onClick={() => void previous.refetch()}>
                Retry previous terms
              </Button>
            )}
            {trade.data.status === 'proposed' && (
              <p>
                Everyone must agree to version {trade.data.currentVersion}.
                Earlier agreement does not apply to these terms.
              </p>
            )}
          </section>
        )}
        {trade.data.status === 'confirmed' && (
          <p>
            Confirmed terms are read-only. Agreement does not mean delivery.
            Cancellation is only available before any recorded receipt or
            handover.
          </p>
        )}
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
        {withdrawn.length > 0 && (
          <p role="alert">
            {withdrawn.length} proposed{' '}
            {withdrawn.length === 1 ? 'item is' : 'items are'} no longer
            available. Review current availability before acceptance.
          </p>
        )}
      </div>
      <TradeAcceptance
        key={`acceptance:${session?.user.id}:${id}`}
        detail={trade.data}
      />
      {self && (
        <TradeCoffee
          key={`coffee:${session?.user.id}:${id}`}
          detail={trade.data}
        />
      )}
      {self && (
        <TradeMeeting
          key={`meeting:${session?.user.id}:${id}`}
          detail={trade.data}
        />
      )}
      {trade.data.groupConversationId && (
        <GroupInvitation id={trade.data.groupConversationId} />
      )}
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
              <p>
                {item.conditionSnapshot} · {item.descriptionSnapshot} · Listing
                revision {item.listingRevision}
              </p>
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
              {invitations[person.invitationStatus]} ·{' '}
              {person.acceptedVersion === trade.data.currentVersion
                ? 'Current terms accepted'
                : trade.data.status === 'proposed' &&
                    trade.data.currentVersion > 1
                  ? 'Renewed agreement required'
                  : 'Current terms not accepted'}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel route-panel">
        <h2>History</h2>
        <ol>
          {trade.data.events.map((event) => (
            <li key={event.id}>
              {event.eventType === 'receipt_acknowledged'
                ? 'Receipt acknowledged'
                : event.eventType === 'handover_reported'
                  ? 'Partial handover reported'
                  : event.eventType === 'disputed'
                    ? 'Problem reported · dispute unresolved'
                    : event.eventType === 'revised'
                      ? 'Terms revised'
                      : (statuses[event.eventType] ?? event.eventType)}{' '}
              by {names.get(event.actorId) ?? 'Member'} · version{' '}
              {event.version} ·{' '}
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
