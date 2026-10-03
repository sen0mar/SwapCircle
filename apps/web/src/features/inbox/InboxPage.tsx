import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { Avatar } from '../account/Avatar';
import { ConversationDenied } from './inbox-api';
import { useInbox, useThread } from './useInbox';
import { useInboxRealtime } from './useInboxRealtime';
import { useVisibleRead } from './useVisibleRead';
import { GroupInvitation } from '../groups/GroupInvitation';
import { useGroup } from '../groups/useGroup';
import { UnreadBadge } from './UnreadBadge';
import { useComposer } from './MessageComposerProvider';

export function MessageTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </time>
  );
}

export function InboxPage() {
  const { id } = useParams();
  const { drafts, setDraft } = useComposer();
  const live = useInboxRealtime(id);

  return (
    <section aria-labelledby="inbox-title">
      <h1 id="inbox-title">Messages</h1>
      {live.status && (
        <div>
          <p role="status">{live.status}</p>
          <Button onClick={live.retry}>Retry live updates</Button>
        </div>
      )}
      <div className={`inbox-layout ${id ? 'has-thread' : ''}`}>
        <ConversationList selected={id} />
        {id ? (
          <Thread
            key={id}
            id={id}
            draft={drafts[id] ?? ''}
            setDraft={(draft) => setDraft(id, draft)}
          />
        ) : (
          <section className="panel inbox-placeholder">
            <h2>Your conversations</h2>
            <p>
              Choose a conversation to read its history, or use Message on a
              member’s profile.
            </p>
          </section>
        )}
      </div>
    </section>
  );
}

function ConversationList({ selected }: { selected: string | undefined }) {
  const inbox = useInbox();
  const location = useLocation();
  const returnId: unknown = location.state?.returnToConversation;
  const returnLink = useRef<HTMLAnchorElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (!selected && typeof returnId === 'string' && inbox.isSuccess)
      (returnLink.current ?? title.current)?.focus();
  }, [selected, returnId, inbox.isSuccess]);

  return (
    <section
      className="panel inbox-list"
      tabIndex={0}
      aria-labelledby="conversations-title"
    >
      <h2 id="conversations-title" ref={title} tabIndex={-1}>
        Conversations
      </h2>
      <p className="inbox-note">Newest conversations first</p>
      {inbox.isPending ? (
        <p role="status">Loading conversations…</p>
      ) : inbox.isError ? (
        <>
          <p role="alert">
            Conversations could not be loaded. Check your connection and retry.
          </p>
          <Button onClick={() => void inbox.refetch()}>Retry inbox</Button>
        </>
      ) : (
        <>
          {inbox.data.pages.some((page) =>
            page.items.some((item) => item.unreadCount === null),
          ) && (
            <Button onClick={() => void inbox.refetch()}>
              Retry unread counts
            </Button>
          )}
          {!inbox.data.pages[0]?.items.length && (
            <p>
              No conversations yet. You can message a member without a trade or
              shared interests.
            </p>
          )}
          <ul className="conversation-list">
            {inbox.data.pages
              .flatMap((page) => page.items)
              .map(({ conversation, profile, group, latest, unreadCount }) => {
                const name =
                  conversation.type === 'group'
                    ? group?.members
                        .filter((member) => member.active)
                        .map((member) => member.displayName)
                        .join(', ') || 'Group conversation'
                    : (profile?.displayName ?? 'Member unavailable');
                return (
                  <li key={conversation.id}>
                    <Link
                      to={`/inbox/${conversation.id}`}
                      ref={
                        returnId === conversation.id ? returnLink : undefined
                      }
                      aria-current={
                        selected === conversation.id ? 'page' : undefined
                      }
                    >
                      <Avatar url={profile?.avatarUrl ?? null} name={name} />
                      <span className="conversation-summary">
                        <strong>{name}</strong>
                        <UnreadBadge count={unreadCount} />
                        <span>
                          {conversation.type === 'group'
                            ? 'Group'
                            : 'Direct message'}
                        </span>
                        <span className="inbox-preview">
                          {latest?.body ?? 'No messages yet'}
                        </span>
                        <MessageTime
                          value={latest?.created_at ?? conversation.created_at}
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
          {inbox.hasNextPage && (
            <Button
              disabled={inbox.isFetchingNextPage}
              onClick={() => void inbox.fetchNextPage()}
            >
              {inbox.isFetchingNextPage
                ? 'Loading conversations…'
                : 'More conversations'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function Thread({
  id,
  draft,
  setDraft,
}: {
  id: string;
  draft: string;
  setDraft: (value: string) => void;
}) {
  const { conversation, history, messages, profiles, peer, userId } =
    useThread(id);
  const composer = useComposer();
  const group = useGroup(id, conversation.data?.type === 'group');
  const local = composer.outbox.filter(
    (message) =>
      message.payload.conversation_id === id &&
      !messages.some(
        (saved) =>
          saved.sender_id === userId &&
          saved.client_message_id === message.payload.client_message_id,
      ),
  );

  useEffect(() => {
    if (history.data)
      composer.reconcile(history.data.pages.flatMap((page) => page.items));
  }, [history.data, composer.reconcile]);

  const localLayout = local
    .map(
      (message) =>
        `${message.payload.client_message_id}:${message.status}:${message.delayed}`,
    )
    .join(',');
  const scroll = useRef<HTMLDivElement>(null);
  const read = useVisibleRead(
    id,
    scroll,
    messages,
    conversation.isSuccess && !conversation.isError && !history.isError,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const initialized = useRef(false);
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    heading.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport || !history.data) return;

    if (anchor.current) {
      viewport.scrollTop =
        anchor.current.top + viewport.scrollHeight - anchor.current.height;
      anchor.current = null;
    } else if (!initialized.current || atBottom.current) {
      viewport.scrollTop = viewport.scrollHeight;
      initialized.current = true;
    }
  }, [history.data, localLayout]);

  const older = async () => {
    const viewport = scroll.current;
    if (viewport)
      anchor.current = {
        height: viewport.scrollHeight,
        top: viewport.scrollTop,
      };
    const result = await history.fetchNextPage();
    if (result.isError) anchor.current = null;
  };
  const denied =
    conversation.error instanceof ConversationDenied ||
    history.error instanceof ConversationDenied;

  useEffect(() => {
    if (denied) composer.discard(id);
  }, [denied, id, composer.discard]);

  const unavailable =
    conversation.isError || (history.isError && !history.data);
  const name =
    conversation.data?.type === 'group'
      ? 'Group conversation'
      : peer
        ? (profiles?.get(peer)?.displayName ?? 'Conversation')
        : 'Conversation';

  return (
    <section className="panel inbox-thread" aria-labelledby="thread-title">
      <header className="thread-header">
        <Link
          className="inbox-back"
          to="/inbox"
          state={{ returnToConversation: id }}
        >
          Back to conversations
        </Link>
        <div className="thread-identity">
          <Avatar
            url={peer ? (profiles?.get(peer)?.avatarUrl ?? null) : null}
            name={name}
          />
          <div>
            <h2 id="thread-title" ref={heading} tabIndex={-1}>
              {denied ? 'Conversation unavailable' : name}
            </h2>
            {group.data && !denied && (
              <p>
                {group.data.members
                  .filter((member) => member.active)
                  .map((member) => member.displayName)
                  .join(', ')}
              </p>
            )}
            {conversation.data && !denied && (
              <p>
                {conversation.data.type === 'group'
                  ? 'Group conversation'
                  : 'Direct message'}
              </p>
            )}
          </div>
        </div>
      </header>
      {conversation.data?.type === 'group' && !denied && (
        <details className="group-thread-membership">
          <summary>Participants and chat membership</summary>
          <GroupInvitation id={id} thread />
        </details>
      )}
      {denied ? (
        <p role="alert">
          This conversation cannot be found or you do not have access.
        </p>
      ) : unavailable ? (
        <>
          <p role="alert">
            History could not be loaded. Check your connection and retry.
          </p>
          <Button
            onClick={() => {
              void conversation.refetch();
              void history.refetch();
            }}
          >
            Retry history
          </Button>
        </>
      ) : conversation.isPending || !history.data ? (
        <p role="status">Loading history…</p>
      ) : (
        <>
          <Button
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            Refresh history
          </Button>
          <div
            className="thread-scroll"
            ref={scroll}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              atBottom.current =
                viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight <
                40;
            }}
            tabIndex={0}
            role="region"
            aria-label="Message history"
          >
            {history.hasNextPage && (
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void older()}
              >
                {history.isFetchingNextPage
                  ? 'Loading older messages…'
                  : 'Load older messages'}
              </Button>
            )}
            {history.isError && (
              <p role="alert">
                History could not be updated. Refresh history or retry loading
                older messages.
              </p>
            )}
            {messages.length || local.length ? (
              <ol className="message-history">
                {messages.map((message) => {
                  const sender =
                    message.sender_id === userId
                      ? 'You'
                      : (group.data?.members.find(
                          (member) => member.userId === message.sender_id,
                        )?.displayName ??
                        profiles?.get(message.sender_id)?.displayName ??
                        'Member unavailable');
                  return (
                    <li
                      key={message.id}
                      data-message-order={message.message_order}
                      data-message-id={message.id}
                      className={
                        message.sender_id === userId ? 'message-own' : ''
                      }
                    >
                      <div className="message-bubble">
                        <strong>{sender}</strong>
                        <p>{message.body}</p>
                        <MessageTime value={message.created_at} />
                        {message.sender_id === userId && (
                          <span className="message-status">Sent</span>
                        )}
                      </div>
                    </li>
                  );
                })}
                {local.map((message) => (
                  <li
                    key={message.payload.client_message_id}
                    className="message-own"
                  >
                    <div className="message-bubble">
                      <strong>You</strong>
                      <p>{message.payload.body}</p>
                      {message.status === 'pending' ? (
                        <span role="status">
                          {message.delayed
                            ? 'Connecting… The API may be waking up.'
                            : 'Sending…'}
                        </span>
                      ) : (
                        <>
                          <p role="alert">
                            Save could not be confirmed. Your text is kept here.
                          </p>
                          <Button onClick={() => composer.retry(message)}>
                            Retry message
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No messages yet.</p>
            )}
          </div>
          {read.error && (
            <div>
              <p role="status">
                Read progress could not be saved. Unread counts may be out of
                date.
              </p>
              <Button onClick={read.retry}>Retry read progress</Button>
            </div>
          )}
          <form
            className="composer-shell"
            onSubmit={(event) => {
              event.preventDefault();
              composer.send(id);
            }}
          >
            <label htmlFor="message-draft">Message draft</label>
            <textarea
              id="message-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={5000}
              rows={3}
              aria-describedby="composer-help"
            />
            <div>
              <p id="composer-help">
                Sent means saved by the server. New messages update live;
                refresh history if your connection is interrupted. Drafts and
                failed sends stay while you browse; reloading clears them.
              </p>
              <Button type="submit" disabled={!draft.trim()}>
                Send message
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
