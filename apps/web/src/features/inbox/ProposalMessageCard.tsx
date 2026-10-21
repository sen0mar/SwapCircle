import { useQuery } from '@tanstack/react-query';
import {
  messagePhotoSchema,
  type MessageRead,
  type MessageProposalState,
} from '@swapcircle/contracts';
import { Link } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { conditions } from '../browse/ListingContent';
import { useProposalResponse } from './useProposalResponses';

export function MessagePhoto({ id }: { id: string }) {
  const { request, session } = useAuth();
  const photo = useQuery({
    queryKey: ['private', session?.user.id, 'message-photo', id],
    queryFn: ({ signal }) =>
      request(
        `/api/v1/conversations/messages/${id}/photo`,
        messagePhotoSchema,
        { signal },
      ),
    retry: false,
  });

  if (photo.isPending) return <p role="status">Loading photo…</p>;
  if (photo.isError)
    return (
      <div>
        <p role="alert">Photo could not be loaded.</p>
        <Button onClick={() => void photo.refetch()}>Retry photo</Button>
      </div>
    );

  return (
    <img
      className="message-photo"
      src={photo.data.dataUrl}
      alt="Photo of the offered trade item"
    />
  );
}

export function ProposalMessageCard({
  message,
  knownResponse,
  showConversationLink = false,
}: {
  message: MessageRead;
  knownResponse?: MessageProposalState;
  showConversationLink?: boolean;
}) {
  const { session } = useAuth();
  const { state, respond, response } = useProposalResponse(
    message.id,
    knownResponse,
  );
  const proposal = message.proposal!;

  return (
    <article
      className="proposal-message-card"
      aria-labelledby={`proposal-${message.id}`}
    >
      <header className="proposal-message-header">
        <h3 id={`proposal-${message.id}`}>
          <ArrowLeftRight size={18} aria-hidden="true" />
          Trade proposal
        </h3>
        <p>
          In exchange for{' '}
          <Link to={`/listings/${proposal.listingId}`}>
            {proposal.listingTitle}
          </Link>
        </p>
      </header>
      {message.has_photo && (
        <div className="proposal-message-photo">
          <MessagePhoto id={message.id} />
        </div>
      )}
      <div className="proposal-message-details">
        <p className="proposal-message-body">{proposal.message}</p>
        {proposal.condition && (
          <dl className="proposal-message-quality">
            <div>
              <dt>Offered item quality</dt>
              <dd>{conditions[proposal.condition]}</dd>
            </div>
          </dl>
        )}
      </div>
      <footer>
        <div className="proposal-response-area">
          {response ? (
            response.status === 'pending' ? (
              response.recipientId === session?.user.id ? (
                <div className="proposal-response-actions">
                  <Button
                    variant="primary"
                    disabled={respond.isPending}
                    onClick={() => respond.mutate('accept')}
                  >
                    {respond.isPending && respond.variables === 'accept'
                      ? 'Accepting…'
                      : 'Accept proposal'}
                  </Button>
                  <Button
                    disabled={respond.isPending}
                    onClick={() => respond.mutate('refuse')}
                  >
                    {respond.isPending && respond.variables === 'refuse'
                      ? 'Refusing…'
                      : 'Refuse proposal'}
                  </Button>
                </div>
              ) : (
                <p role="status">Awaiting a response</p>
              )
            ) : (
              <div className="proposal-response-saved">
                <p role="status">
                  {response.status === 'accepted' ? 'Accepted' : 'Refused'}
                </p>
                {response.status === 'accepted' && (
                  <Link
                    to={
                      showConversationLink
                        ? `/inbox/${message.conversation_id}`
                        : '/swaps'
                    }
                  >
                    {showConversationLink
                      ? 'Open swap conversation'
                      : 'View in My Swaps'}
                  </Link>
                )}
              </div>
            )
          ) : state.isError ? (
            <div>
              <p role="alert">Proposal response could not be loaded.</p>
              <Button onClick={() => void state.refetch()}>
                Retry proposal status
              </Button>
            </div>
          ) : (
            <p role="status">Loading proposal status…</p>
          )}
          {respond.isError && response?.status === 'pending' && (
            <p role="alert">
              {respond.error instanceof Error
                ? respond.error.message
                : 'Your response could not be saved. Please retry.'}
            </p>
          )}
        </div>
        <MessageTime value={message.created_at} />
      </footer>
    </article>
  );
}

export function MessageTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })}
    </time>
  );
}
