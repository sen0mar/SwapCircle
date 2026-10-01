import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { useComposer } from '../inbox/MessageComposerProvider';
import { useGroup, useGroupResponse } from './useGroup';

const labels = {
  pending: 'Invitation pending',
  accepted: 'Joined chat',
  declined: 'Declined chat',
  left: 'Left chat',
};

export function GroupInvitation({
  id,
  thread = false,
}: {
  id: string;
  thread?: boolean;
}) {
  const { readSignal } = useAuth();
  const group = useGroup(id);
  const response = useGroupResponse(id);
  const navigate = useNavigate();
  const composer = useComposer();
  const [leaving, setLeaving] = useState(false);

  const respond = async (action: 'accept' | 'decline' | 'leave') => {
    try {
      const result = await response.mutateAsync(action);
      if (readSignal.aborted) return;
      if (result.active) void navigate(`/inbox/${id}`);
      else {
        composer.discard(id);
        setLeaving(false);
        if (thread) void navigate(`/groups/${id}`);
      }
    } catch {
      // Mutation state provides the retry feedback; consent is never inferred.
    }
  };

  return (
    <section className="panel route-panel" aria-label="Group chat membership">
      <h2>Group chat</h2>
      <p>
        Joining this chat does not accept the trade terms, coffee, or meeting
        arrangements. Earlier direct messages stay in their separate
        conversations.
      </p>
      {group.isPending ? (
        <p role="status">Loading group invitation…</p>
      ) : group.isError ? (
        <>
          <p role="alert">
            {group.error instanceof ApiError &&
            [403, 404].includes(group.error.status ?? 0)
              ? 'This group invitation is unavailable or you do not have access.'
              : 'The group invitation could not be loaded.'}
          </p>
          <Button onClick={() => void group.refetch()}>Retry invitation</Button>
        </>
      ) : (
        <>
          <p role="status">
            {labels[group.data.status]}
            {group.data.status === 'accepted' && !group.data.active
              ? ' · Access revoked'
              : ''}
          </p>
          <ul>
            {group.data.members.map((member) => (
              <li key={member.userId}>
                {member.displayName} · {labels[member.status]}
                {member.status === 'accepted' && !member.active
                  ? ' · Access revoked'
                  : ''}
              </li>
            ))}
          </ul>
          <p>
            <Link to={`/swaps/${group.data.tradeId}`}>View swap terms</Link>
          </p>
          {group.data.status === 'pending' && (
            <div className="notification-actions">
              <Button
                disabled={response.isPending}
                onClick={() => respond('accept')}
              >
                Join group chat
              </Button>
              <Button
                variant="secondary"
                disabled={response.isPending}
                onClick={() => respond('decline')}
              >
                Decline group chat
              </Button>
            </div>
          )}
          {group.data.active && (
            <>
              {!thread && (
                <p>
                  <Link to={`/inbox/${id}`}>Open group conversation</Link>
                </p>
              )}
              {leaving ? (
                <div>
                  <p>
                    Leaving stops future access to this chat. Messages already
                    viewed by other members cannot be erased from their memory
                    or devices. Your trade response remains separate.
                  </p>
                  <Button
                    disabled={response.isPending}
                    onClick={() => respond('leave')}
                  >
                    Confirm leave group chat
                  </Button>{' '}
                  <Button
                    variant="secondary"
                    disabled={response.isPending}
                    onClick={() => setLeaving(false)}
                  >
                    Keep membership
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setLeaving(true)}>
                  Leave group chat
                </Button>
              )}
            </>
          )}
          {!group.data.active && group.data.status !== 'pending' && (
            <p>
              You cannot read or send group messages. Direct conversations
              remain available separately.
            </p>
          )}
        </>
      )}
      {response.isPending && <p role="status">Saving chat response…</p>}
      {response.isError && (
        <p role="alert">
          Your chat response could not be confirmed. Review the current
          invitation and retry. No trade agreement was submitted.
        </p>
      )}
    </section>
  );
}

export function GroupInvitationPage() {
  const { id = '' } = useParams();

  return (
    <article>
      <h1>Group invitation</h1>
      <GroupInvitation key={id} id={id} />
      <p>
        <Link to="/inbox">Back to conversations</Link>
      </p>
    </article>
  );
}
