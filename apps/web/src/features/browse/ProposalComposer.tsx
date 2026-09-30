import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  proposalDraftSchema,
  type Listing,
  type ProposalDraft,
  type ProposalCreation,
} from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { getListing, getListings } from './listing-api';
import { getMembers } from '../home/discovery-api';
import { getCurrentProfile } from '../account/profile-api';
import { useAuth } from '../auth/AuthProvider';
import { useCreateTrade } from '../trades/useTrades';

function MemberItems({
  memberId,
  memberName,
  selected,
  onSelect,
}: {
  memberId: string;
  memberName: string;
  selected: ProposalDraft['transfers'];
  onSelect: (item: Listing) => void;
}) {
  const listings = useInfiniteQuery({
    queryKey: ['proposal-items', memberId],
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      getListings(
        {
          owner: memberId,
          availability: 'available',
          cursor: pageParam,
          limit: 50,
        },
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = listings.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="proposal-member-items">
      <h3>{memberName} gives</h3>
      {listings.isPending && <p role="status">Loading available items…</p>}
      {listings.isError && (
        <p role="alert">
          Items could not be loaded.{' '}
          <Button onClick={() => void listings.refetch()}>Retry items</Button>
        </p>
      )}
      {listings.isSuccess && !items.length && (
        <p>No available items right now.</p>
      )}
      {items.map((item) => (
        <label key={item.id} className="proposal-choice">
          <input
            type="checkbox"
            checked={selected.some(
              (transfer) => transfer.listingId === item.id,
            )}
            onChange={() => onSelect(item)}
          />
          <span>{item.title}</span>
        </label>
      ))}
      {listings.hasNextPage && (
        <Button
          disabled={listings.isFetchingNextPage}
          onClick={() => void listings.fetchNextPage()}
        >
          {listings.isFetchingNextPage
            ? 'Loading…'
            : `More items from ${memberName}`}
        </Button>
      )}
    </div>
  );
}

export function ProposalComposer({
  item,
  ownerName,
}: {
  item: Listing;
  ownerName: string;
}) {
  const { session, request } = useAuth();
  const navigate = useNavigate();
  const create = useCreateTrade();
  const selfId = session?.user.id ?? '';
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pendingCreation, setPendingCreation] =
    useState<ProposalCreation | null>(null);
  const [membersCursor, setMembersCursor] = useState('');
  const [draft, setDraft] = useState<ProposalDraft>({
    participantIds: [selfId, item.ownerId],
    transfers: [
      { listingId: item.id, ownerId: item.ownerId, recipientId: selfId },
    ],
    meetingMode: 'meet_to_swap',
  });
  const [titles, setTitles] = useState<Record<string, string>>({
    [item.id]: item.title,
  });
  const [names, setNames] = useState<Record<string, string>>({
    [item.ownerId]: ownerName,
  });
  const me = useQuery({
    queryKey: ['private', selfId, 'profile'],
    queryFn: ({ signal }) => getCurrentProfile(request, signal),
    enabled: open && !!selfId,
    retry: false,
  });
  const members = useQuery({
    queryKey: ['proposal-members', membersCursor],
    queryFn: ({ signal }) =>
      getMembers(
        { limit: 50, cursor: membersCursor || undefined },
        false,
        request,
        signal,
      ),
    enabled: open && !!selfId,
    retry: false,
  });
  const displayName = (id: string) =>
    id === selfId ? (me.data?.displayName ?? 'You') : (names[id] ?? 'Member');
  const close = () => {
    setOpen(false);
    setReview(false);
    setError(null);
  };

  const toggleItem = (selected: Listing) => {
    setError(null);
    setTitles((current) => ({ ...current, [selected.id]: selected.title }));
    setDraft((current) => ({
      ...current,
      transfers: current.transfers.some(
        (transfer) => transfer.listingId === selected.id,
      )
        ? current.transfers.filter(
            (transfer) => transfer.listingId !== selected.id,
          )
        : [
            ...current.transfers,
            {
              listingId: selected.id,
              ownerId: selected.ownerId,
              recipientId:
                current.participantIds.find((id) => id !== selected.ownerId) ??
                '',
            },
          ],
    }));
  };

  const startReview = async () => {
    const result = proposalDraftSchema.safeParse(draft);

    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Check the proposal terms.');
      return;
    }

    setChecking(true);
    setError(null);

    try {
      const checks = await Promise.allSettled(
        draft.transfers.map((transfer) =>
          getListing(transfer.listingId, new AbortController().signal),
        ),
      );
      const missing = checks.findIndex(
        (check) =>
          check.status === 'rejected' &&
          check.reason instanceof ApiError &&
          check.reason.status === 404,
      );

      if (missing !== -1) {
        setError(
          `${titles[draft.transfers[missing]!.listingId] ?? 'An item'} is no longer available. Remove it and choose another item.`,
        );
        return;
      }

      if (checks.some((check) => check.status === 'rejected')) {
        setError(
          'Item availability could not be checked. Try again before reviewing.',
        );
        return;
      }

      const latest = checks.map((check) => {
        if (check.status === 'rejected') throw check.reason;
        return check.value;
      });
      const changed = latest.find(
        (listing, index) =>
          listing.availability !== 'available' ||
          listing.ownerId !== draft.transfers[index]?.ownerId,
      );

      if (changed) {
        setError(
          `${changed.title} is unavailable or its owner changed. Remove it and choose another item.`,
        );
        return;
      }

      setTitles((current) =>
        Object.assign(
          {},
          current,
          ...latest.map((listing) => ({ [listing.id]: listing.title })),
        ),
      );
      setReview(true);
    } catch {
      setError(
        'Item availability could not be checked. Try again before reviewing.',
      );
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    const input =
      pendingCreation &&
      JSON.stringify({
        ...pendingCreation,
        operationKey: undefined,
        expiresAt: undefined,
      }) === JSON.stringify(draft)
        ? pendingCreation
        : {
            ...draft,
            operationKey: crypto.randomUUID(),
            expiresAt: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString(),
          };
    setPendingCreation(input);
    setError(null);

    try {
      const result = await create.mutateAsync(input);
      close();
      void navigate(`/swaps/${result.id}`);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'The trade could not be sent. Please retry.',
      );
    }
  };

  if (!selfId || selfId === item.ownerId || item.availability !== 'available')
    return null;

  return (
    <div className="message-action">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Propose a trade
      </Button>
      <p>Invite members to review a proposed swap.</p>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="proposal-dialog">
          <DialogTitle>
            {review ? 'Review your proposal' : 'Build a proposal'}
          </DialogTitle>
          <DialogDescription>
            Review the terms before sending. Items stay available until a later
            confirmation.
          </DialogDescription>
          {review ? (
            <div className="proposal-content">
              <p>
                <strong>Meet to swap</strong> · {draft.participantIds.length}{' '}
                people
              </p>
              <ul className="proposal-summary" aria-label="Trade transfers">
                {draft.transfers.map((transfer) => (
                  <li key={transfer.listingId}>
                    <strong>{displayName(transfer.ownerId)}</strong> gives{' '}
                    <strong>{titles[transfer.listingId] ?? 'Item'}</strong> to{' '}
                    <strong>{displayName(transfer.recipientId)}</strong>.
                  </li>
                ))}
              </ul>
              <p>
                Invitations will be sent to the other participants. This
                proposal expires in seven days. Items are not reserved.
              </p>
              <div className="proposal-actions">
                <Button
                  disabled={create.isPending}
                  onClick={() => setReview(false)}
                >
                  Edit draft
                </Button>
                <Button
                  variant="primary"
                  disabled={create.isPending}
                  onClick={() => void submit()}
                >
                  {create.isPending ? 'Sending…' : 'Send proposal'}
                </Button>
              </div>
              {error && (
                <p role="alert" className="ui-feedback-error">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="proposal-content">
              <h3>People</h3>
              <p>Choose everyone who will give or receive an item.</p>
              <ul className="proposal-participants">
                {draft.participantIds.map((id) => (
                  <li key={id}>
                    {displayName(id)}
                    {id !== selfId && id !== item.ownerId && (
                      <Button
                        aria-label={`Remove ${displayName(id)}`}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            participantIds: current.participantIds.filter(
                              (person) => person !== id,
                            ),
                            transfers: current.transfers
                              .filter((transfer) => transfer.ownerId !== id)
                              .map((transfer) =>
                                transfer.recipientId === id
                                  ? { ...transfer, recipientId: selfId }
                                  : transfer,
                              ),
                          }));
                          setError(null);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {members.isPending && <p role="status">Loading members…</p>}
              {members.isError && (
                <p role="alert">
                  Members could not be loaded.{' '}
                  <Button onClick={() => void members.refetch()}>
                    Retry members
                  </Button>
                </p>
              )}
              {members.data && (
                <label>
                  Add a person
                  <select
                    value=""
                    onChange={(event) => {
                      const member = members.data.items.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (!member || draft.participantIds.includes(member.id))
                        return;
                      setNames((current) => ({
                        ...current,
                        [member.id]: member.displayName,
                      }));
                      setDraft((current) => ({
                        ...current,
                        participantIds: [...current.participantIds, member.id],
                      }));
                      setError(null);
                    }}
                  >
                    <option value="">Choose a member</option>
                    {members.data.items
                      .filter(
                        (member) => !draft.participantIds.includes(member.id),
                      )
                      .map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {members.data?.nextCursor && (
                <Button
                  onClick={() =>
                    setMembersCursor(members.data.nextCursor ?? '')
                  }
                >
                  More members
                </Button>
              )}
              <h3>Items and recipients</h3>
              {draft.participantIds.map((id) => (
                <MemberItems
                  key={id}
                  memberId={id}
                  memberName={displayName(id)}
                  selected={draft.transfers}
                  onSelect={toggleItem}
                />
              ))}
              {draft.transfers.map((transfer) => (
                <label className="proposal-recipient" key={transfer.listingId}>
                  <span>
                    {displayName(transfer.ownerId)} gives{' '}
                    {titles[transfer.listingId] ?? 'Item'} to
                  </span>
                  <select
                    value={transfer.recipientId}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        transfers: current.transfers.map((entry) =>
                          entry.listingId === transfer.listingId
                            ? { ...entry, recipientId: event.target.value }
                            : entry,
                        ),
                      }));
                      setError(null);
                    }}
                  >
                    {draft.participantIds.map((id) => (
                      <option key={id} value={id}>
                        {displayName(id)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p>
                <strong>Meet to swap</strong> is the default. Coffee invitations
                will be available after eligibility checks are implemented.
              </p>
              {error && (
                <p role="alert" className="ui-feedback-error">
                  {error}
                </p>
              )}
              <div className="proposal-actions">
                <Button onClick={close}>Keep draft and close</Button>
                <Button
                  variant="primary"
                  disabled={checking}
                  onClick={() => void startReview()}
                >
                  {checking ? 'Checking items…' : 'Review proposal'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
