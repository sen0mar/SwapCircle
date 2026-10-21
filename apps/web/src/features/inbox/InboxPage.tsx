import {
  MessagePhoto,
  MessageTime,
  ProposalMessageCard,
} from './ProposalMessageCard';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
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

export function InboxPage() {
  const { id } = useParams();
  const { drafts, setDraft } = useComposer();
  const live = useInboxRealtime(id);

  return (
    <section className="inbox-page" aria-labelledby="inbox-title">
      <h1 id="inbox-title" className="sr-only">
        Messages
      </h1>
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
                        <span className="conversation-name-row">
                          <strong>{name}</strong>
                          {conversation.type === 'group' && (
                            <span className="conversation-group-badge">
                              Group
                            </span>
                          )}
                        </span>
                        <span className="inbox-preview">
                          {latest?.proposal
                            ? `Trade proposal · ${latest.proposal.listingTitle}`
                            : (latest?.body ?? 'No messages yet')}
                        </span>
                      </span>
                      <UnreadBadge count={unreadCount} />
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
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = input.current;
    if (!textarea) return;

    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }, [draft, history.data]);

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
            {conversation.data?.type === 'group' && !denied && (
              <p>Group conversation</p>
            )}
          </div>
        </div>
        {!denied && !unavailable && history.data && (
          <Button
            className="thread-refresh"
            variant="ghost"
            aria-label="Refresh history"
            title="Refresh history"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        )}
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
                {messages.map((message, index) => (
                  <Fragment key={message.id}>
                    {(index === 0 ||
                      new Date(message.created_at).toDateString() !==
                        new Date(
                          messages[index - 1]!.created_at,
                        ).toDateString()) && (
                      <li className="message-day">
                        <time dateTime={message.created_at}>
                          {new Date(message.created_at).toLocaleDateString(
                            undefined,
                            {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            },
                          )}
                        </time>
                      </li>
                    )}
                    <li
                      data-message-order={message.message_order}
                      data-message-id={message.id}
                      className={
                        message.sender_id === userId ? 'message-own' : ''
                      }
                    >
                      {message.proposal ? (
                        <ProposalMessageCard message={message} />
                      ) : (
                        <div className="message-bubble">
                          <p>{message.body}</p>
                          {message.has_photo && (
                            <MessagePhoto id={message.id} />
                          )}
                          <MessageTime value={message.created_at} />
                        </div>
                      )}
                    </li>
                  </Fragment>
                ))}
                {local.map((message) => (
                  <li
                    key={message.payload.client_message_id}
                    className="message-own"
                  >
                    <div className="message-bubble">
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
            <label className="sr-only" htmlFor="message-draft">
              Message draft
            </label>
            <textarea
              ref={input}
              id="message-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={5000}
              rows={1}
              placeholder="Write a message…"
              aria-describedby="composer-help"
            />
            <div>
              <p id="composer-help" className="sr-only">
                Drafts stay while you browse. Reloading clears unsent text.
              </p>
              <Button type="submit" disabled={!draft.trim()}>
                Send
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
