import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  messagePhotoSchema,
  type MessageRead,
  type MessageProposalState,
} from '@swapcircle/contracts';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/AuthProvider';
import { conditions } from '../browse/ListingContent';
import { ProposalAcceptDialog } from './ProposalAcceptDialog';
import { useListingPhotos } from '../browse/listing-photos';
import { useProposalResponse } from './useProposalResponses';

function OfferedListing({ id, title }: { id: string; title: string }) {
  const photos = useListingPhotos(id);
  const [failedUrl, setFailedUrl] = useState('');
  const photo = photos.data?.[0];

  return (
    <section className="proposal-offered-listing">
      {photo && photo.url !== failedUrl && (
        <img
          src={photo.url}
          alt={title}
          loading="lazy"
          onError={() => setFailedUrl(photo.url)}
        />
      )}
      <div>
        <span className="proposal-field-label">Offered item</span>
        <Link to={`/listings/${id}`}>{title}</Link>
      </div>
    </section>
  );
}

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
  meetingAction,
}: {
  message: MessageRead;
  knownResponse?: MessageProposalState;
  showConversationLink?: boolean;
  meetingAction?: ReactNode;
}) {
  const { session } = useAuth();
  const { state, respond, response } = useProposalResponse(
    message.id,
    knownResponse,
  );
  const proposal = message.proposal!;
  const [acceptOpen, setAcceptOpen] = useState(false);
  const responseArea = useRef<HTMLDivElement>(null);

  return (
    <article
      className="proposal-message-card"
      aria-labelledby={`proposal-${message.id}`}
    >
      <header className="proposal-message-header">
        <div className="proposal-message-topline">
          <h3 id={`proposal-${message.id}`}>Trade proposal</h3>
          {response && response.status !== 'pending' && (
            <span
              role="status"
              className={`proposal-status proposal-status-${response.status}`}
            >
              {response.status === 'accepted' ? 'Accepted' : 'Refused'}
            </span>
          )}
        </div>
        <span className="proposal-field-label">Requested item</span>
        <Link
          className="proposal-requested-title"
          to={`/listings/${proposal.listingId}`}
        >
          {proposal.listingTitle}
        </Link>
      </header>
      {message.has_photo && (
        <section className="proposal-message-photo">
          <div className="proposal-photo-thumbnail">
            <MessagePhoto id={message.id} />
          </div>
          <span className="proposal-field-label">Offered item</span>
        </section>
      )}
      <div className="proposal-message-details">
        {proposal.offeredListing && (
          <OfferedListing {...proposal.offeredListing} />
        )}
        <div className="proposal-message-note">
          <span className="proposal-field-label">Message</span>
          <p className="proposal-message-body">{proposal.message}</p>
        </div>
        {proposal.condition && (
          <dl className="proposal-message-quality">
            <div>
              <dt>Offered item quality</dt>
              <dd>{conditions[proposal.condition]}</dd>
            </div>
          </dl>
        )}
      </div>
      <ProposalAcceptDialog
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        respond={respond}
        onCloseFocus={() => {
          const button = responseArea.current?.querySelector('button');
          (button ?? responseArea.current)?.focus();
        }}
        accepted={response?.status === 'accepted'}
      />
      <footer>
        <div
          className="proposal-response-area"
          ref={responseArea}
          tabIndex={-1}
        >
          {response ? (
            response.status === 'pending' ? (
              response.recipientId === session?.user.id ? (
                <div className="proposal-response-actions">
                  <Button
                    variant="primary"
                    disabled={respond.isPending}
                    onClick={() => setAcceptOpen(true)}
                  >
                    {respond.isPending && respond.variables?.action === 'accept'
                      ? 'Accepting…'
                      : 'Accept invite'}
                  </Button>
                  <Button
                    disabled={respond.isPending}
                    onClick={() => respond.mutate({ action: 'refuse' })}
                  >
                    {respond.isPending && respond.variables?.action === 'refuse'
                      ? 'Refusing…'
                      : 'Refuse proposal'}
                  </Button>
                </div>
              ) : (
                <p role="status">Awaiting a response</p>
              )
            ) : (
              <div className="proposal-response-saved">
                {response.meeting && (
                  <section className="proposal-meetup">
                    <h4>Meetup</h4>
                    <dl>
                      <div>
                        <dt>Date</dt>
                        <dd>
                          <time dateTime={response.meeting.meetingAt}>
                            {new Intl.DateTimeFormat(undefined, {
                              timeZone: response.meeting.timeZone,
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                            }).format(new Date(response.meeting.meetingAt))}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt>Time</dt>
                        <dd>
                          {new Intl.DateTimeFormat(undefined, {
                            timeZone: response.meeting.timeZone,
                            hour: '2-digit',
                            minute: '2-digit',
                            hourCycle: 'h23',
                          }).format(new Date(response.meeting.meetingAt))}
                          <span className="proposal-meetup-zone">
                            {response.meeting.timeZone}
                          </span>
                        </dd>
                      </div>
                      <div className="proposal-meetup-location">
                        <dt>Location</dt>
                        <dd>{response.meeting.place}</dd>
                      </div>
                    </dl>
                  </section>
                )}
                <div className="proposal-saved-actions">
                  {meetingAction}
                  {response.status === 'accepted' && (
                    <Button
                      asChild
                      variant={meetingAction ? 'secondary' : 'primary'}
                      className="proposal-view-swap"
                    >
                      <Link
                        to={
                          showConversationLink
                            ? `/inbox/${message.conversation_id}`
                            : `/swaps/offers/${message.id}`
                        }
                      >
                        {showConversationLink
                          ? 'Open swap conversation'
                          : 'View in My Swaps'}
                      </Link>
                    </Button>
                  )}
                </div>
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
