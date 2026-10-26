import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptedProposalDetailSchema,
  type ProposalMeeting,
  type ProposalMeetingUpdate,
} from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import { ProposalMessageCard } from '../inbox/ProposalMessageCard';
import { ProposalMeetingDialog } from '../inbox/ProposalMeetingDialog';

export function AcceptedOfferPage() {
  const { id = '' } = useParams();
  const { session, request } = useAuth();

  return (
    <OfferDetail
      key={`${session?.user.id}:${id}`}
      id={id}
      request={request}
      userId={session?.user.id}
    />
  );
}

function OfferDetail({
  id,
  request,
  userId,
}: {
  id: string;
  request: ReturnType<typeof useAuth>['request'];
  userId: string | undefined;
}) {
  const queries = useQueryClient();
  const key = ['private', userId, 'accepted-offer', id];
  const trigger = useRef<HTMLButtonElement>(null);
  const retry = useRef<ProposalMeetingUpdate | null>(null);
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState<{
    meeting: ProposalMeeting | null;
    revision: number;
  } | null>(null);
  const detail = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request(
        `/api/v1/conversations/messages/${id}/proposal/detail`,
        acceptedProposalDetailSchema,
        { signal },
      ),
    enabled: !!userId,
    retry: false,
    refetchInterval: 15000,
  });
  const save = useMutation({
    mutationFn: (input: ProposalMeetingUpdate) =>
      request(
        `/api/v1/conversations/messages/${id}/proposal/meeting`,
        acceptedProposalDetailSchema,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
    onSuccess: async (saved) => {
      await queries.cancelQueries({ queryKey: key, exact: true });
      queries.setQueryData(key, saved);
      setEditing(false);
      retry.current = null;
      await Promise.all(
        ['proposal-response', 'accepted-proposals', 'notifications'].map(
          (name) =>
            queries.invalidateQueries({ queryKey: ['private', userId, name] }),
        ),
      );
    },
    onError: () => {
      void queries.invalidateQueries({ queryKey: key, exact: true });
    },
  });

  function submit(meeting: ProposalMeeting) {
    if (!base || save.isPending) return;
    const previous = retry.current;
    const input =
      previous &&
      previous.expectedRevision === base.revision &&
      JSON.stringify(previous.meeting) === JSON.stringify(meeting)
        ? previous
        : {
            operationKey: crypto.randomUUID(),
            expectedRevision: base.revision,
            meeting,
          };
    retry.current = input;
    save.mutate(input);
  }

  const denied =
    detail.error instanceof ApiError &&
    [403, 404].includes(detail.error.status ?? 0);
  if (detail.isPending) return <p role="status">Loading swap…</p>;
  if (!detail.data || denied)
    return (
      <section className="panel route-panel">
        <h1>Swap unavailable</h1>
        <p role="alert">
          This accepted swap could not be loaded or is unavailable to this
          account.
        </p>
        {!denied && (
          <Button onClick={() => void detail.refetch()}>Retry swap</Button>
        )}
        <Link to="/swaps">Back to My Swaps</Link>
      </section>
    );

  return (
    <article
      className="trade-detail accepted-offer-detail"
      aria-labelledby="accepted-swap-title"
    >
      <header className="swap-reminder-topbar">
        <Link to="/swaps">← My Swaps</Link>
        <p className="swap-status swap-status-accepted">Accepted</p>
      </header>
      <h1 id="accepted-swap-title">Your swap</h1>
      {detail.isError && (
        <p role="alert">
          The latest details could not be refreshed. Retry before editing.{' '}
          <Button onClick={() => void detail.refetch()}>Retry swap</Button>
        </p>
      )}
      <ProposalMessageCard
        message={detail.data.message}
        knownResponse={detail.data.response}
        showConversationLink
        meetingAction={
          <section
            className="proposal-meeting-action"
            aria-label="Arrange meetup"
          >
            {!detail.data.response.meeting && <p>No meetup arranged yet.</p>}
            <Button
              ref={trigger}
              variant="primary"
              disabled={detail.isError || detail.isFetching}
              onClick={() => {
                setBase({
                  meeting: detail.data.response.meeting,
                  revision: detail.data.response.meetingRevision,
                });
                retry.current = null;
                save.reset();
                setEditing(true);
              }}
            >
              {detail.data.response.meeting
                ? 'Change date and time'
                : 'Plan meetup'}
            </Button>
          </section>
        }
      />
      {base && (
        <ProposalMeetingDialog
          key={base.revision}
          open={editing}
          onOpenChange={setEditing}
          onCloseFocus={() => trigger.current?.focus()}
          initial={base.meeting}
          onSave={submit}
          pending={save.isPending}
          saveError={
            save.isError
              ? `${save.error.message} Your draft is kept. If the meetup changed, close and reopen this form to use the latest details.`
              : undefined
          }
        />
      )}
    </article>
  );
}
