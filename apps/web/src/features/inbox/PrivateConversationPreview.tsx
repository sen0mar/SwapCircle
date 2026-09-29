import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useInbox } from './useInbox';
import { useInboxRealtime } from './useInboxRealtime';
import { UnreadBadge } from './UnreadBadge';
import { Button } from '../../components/ui/button';

export function PrivateConversationPreview() {
  const { session } = useAuth();
  return session ? <SignedInPreview /> : null;
}

function SignedInPreview() {
  const inbox = useInbox();
  const live = useInboxRealtime();

  return (
    <section className="panel" aria-labelledby="private-conversations-title">
      <h2 id="private-conversations-title">Conversations</h2>
      {live.status && <p role="status">{live.status}</p>}
      {inbox.isPending ? (
        <p role="status">Loading conversations…</p>
      ) : inbox.isError ? (
        <>
          <p role="alert">Conversations could not be loaded.</p>
          <Button onClick={() => void inbox.refetch()}>Retry inbox</Button>
        </>
      ) : (
        <ul className="conversation-list">
          {inbox.data.pages
            .flatMap((page) => page.items)
            .slice(0, 3)
            .map(({ conversation, profile, latest, unreadCount }) => (
              <li key={conversation.id}>
                <Link to={`/inbox/${conversation.id}`}>
                  <span className="conversation-summary">
                    <strong>
                      {conversation.type === 'group'
                        ? 'Group conversation'
                        : (profile?.displayName ?? 'Member unavailable')}
                    </strong>
                    <UnreadBadge count={unreadCount} />
                    <span className="inbox-preview">
                      {latest?.body ?? 'No messages yet'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          {!inbox.data.pages[0]?.items.length && <li>No conversations yet.</li>}
        </ul>
      )}
      {inbox.data?.pages.some((page) =>
        page.items.some((item) => item.unreadCount === null),
      ) && (
        <Button onClick={() => void inbox.refetch()}>
          Retry unread counts
        </Button>
      )}
      <Link to="/inbox">Open messages</Link>
    </section>
  );
}
