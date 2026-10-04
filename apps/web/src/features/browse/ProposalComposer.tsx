import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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
import { useCreateTrade, useReviseTrade } from '../trades/useTrades';
import { getTrade, type TradeDetail } from '../trades/trades-api';
import { detailTerms, termChanges } from '../trades/term-changes';

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
  revision,
  onReadOnlyClose,
}:
  | {
      item: Listing;
      ownerName: string;
      revision?: never;
      onReadOnlyClose?: never;
    }
  | {
      item?: never;
      ownerName?: never;
      revision: TradeDetail;
      onReadOnlyClose?: () => void;
    }) {
  const { session, request } = useAuth();
  const navigate = useNavigate();
  const queries = useQueryClient();
  const trigger = useRef<HTMLButtonElement>(null);
  const create = useCreateTrade();
  const revise = useReviseTrade(revision?.id ?? '');
  const [base, setBase] = useState<TradeDetail | undefined>(undefined);
  const [conflict, setConflict] = useState<TradeDetail | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [details, setDetails] = useState<Record<string, Listing>>({});
  const saving = create.isPending || revise.isPending;
  const refreshConflict = async () => {
    if (!revision) return;
    setChecking(true);
    try {
      const latest = await queries.fetchQuery({
        queryKey: ['private', session?.user.id, 'trade', revision.id],
        queryFn: ({ signal }) => getTrade(request, revision.id, signal),
        staleTime: 0,
        retry: false,
      });
      setConflict(latest);
      setNeedsRefresh(false);
    } catch {
      setError(
        'Latest terms could not be loaded. Your draft is kept. Retry loading before submitting.',
      );
      setNeedsRefresh(true);
    } finally {
      setChecking(false);
    }
  };
  const selfId = session?.user.id ?? '';
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pendingCreation, setPendingCreation] =
    useState<ProposalCreation | null>(null);
  const [membersCursor, setMembersCursor] = useState('');
  const [draft, setDraft] = useState<ProposalDraft>({
    participantIds: revision
      ? revision.participants.map((person) => person.userId)
      : [selfId, item!.ownerId],
    transfers: revision
      ? revision.items.map(({ listingId, ownerId, recipientId }) => ({
          listingId,
          ownerId,
          recipientId,
        }))
      : [{ listingId: item!.id, ownerId: item!.ownerId, recipientId: selfId }],
    meetingMode: 'meet_to_swap',
  });
  const [titles, setTitles] = useState<Record<string, string>>({
    ...(revision
      ? Object.fromEntries(
          revision.items.map((entry) => [entry.listingId, entry.titleSnapshot]),
        )
      : { [item!.id]: item!.title }),
  });
  const [names, setNames] = useState<Record<string, string>>({
    ...(revision
      ? Object.fromEntries(
          revision.participants.map((person) => [
            person.userId,
            person.displayName,
          ]),
        )
      : { [item!.ownerId]: ownerName! }),
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
      setDetails(
        Object.fromEntries(latest.map((listing) => [listing.id, listing])),
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
    if (revision && base) {
      if (conflict || needsRefresh) return;
      setError(null);
      try {
        await revise.mutateAsync({
          ...draft,
          expectedVersion: base.currentVersion,
          expiresAt: base.expiresAt,
        });
        close();
        setBase(undefined);
      } catch (cause) {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'The revision could not be saved. Your draft is kept.',
        );
        // A lost response may also hide a committed revision. Never rebase or resubmit automatically.
        setNeedsRefresh(true);
        await refreshConflict();
      }
      return;
    }
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

  if (
    !selfId ||
    (revision && revision.status !== 'proposed' && !open) ||
    (!revision &&
      (selfId === item!.ownerId || item!.availability !== 'available'))
  )
    return null;

  return (
    <div className="message-action">
      {(!revision || revision.status === 'proposed') && (
        <>
          <Button
            ref={trigger}
            variant="primary"
            onClick={() => {
              if (revision && !base) {
                setBase(revision);
                setDraft({
                  participantIds: revision.participants.map(
                    (person) => person.userId,
                  ),
                  transfers: revision.items.map(
                    ({ listingId, ownerId, recipientId }) => ({
                      listingId,
                      ownerId,
                      recipientId,
                    }),
                  ),
                  meetingMode: 'meet_to_swap',
                });
                setTitles(
                  Object.fromEntries(
                    revision.items.map((entry) => [
                      entry.listingId,
                      entry.titleSnapshot,
                    ]),
                  ),
                );
                setNames(
                  Object.fromEntries(
                    revision.participants.map((person) => [
                      person.userId,
                      person.displayName,
                    ]),
                  ),
                );
              }
              setOpen(true);
            }}
          >
            {revision ? 'Edit proposal' : 'Propose a trade'}
          </Button>
          <p>
            {revision
              ? 'Saved terms stay unchanged until your revision succeeds.'
              : 'Invite members to review a proposed swap.'}
          </p>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent
          className="proposal-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current) trigger.current.focus();
            else onReadOnlyClose?.();
          }}
        >
          <DialogTitle>
            {review
              ? revision
                ? 'Review revised terms'
                : 'Review your proposal'
              : revision
                ? 'Edit proposal draft'
                : 'Build a proposal'}
          </DialogTitle>
          <DialogDescription>
            {revision && revision.status !== 'proposed'
              ? 'Saved terms are read-only. Your draft is kept for comparison.'
              : 'Review the terms before sending. Items stay available until a later confirmation.'}
          </DialogDescription>
          {base && (
            <p>
              Editing version {base.currentVersion}. Changes require renewed
              agreement from everyone.
            </p>
          )}
          {needsRefresh && (
            <Button disabled={checking} onClick={() => void refreshConflict()}>
              Load latest terms
            </Button>
          )}
          {conflict && (
            <section
              className="panel route-panel"
              aria-label="Proposal conflict"
            >
              <h3>
                Proposal changed · latest version {conflict.currentVersion}
              </h3>
              <p role="alert">
                Your draft is kept separately. Nothing was resubmitted. Compare
                the latest saved terms before reusing your draft.
              </p>
              {base && (
                <p>
                  {termChanges(detailTerms(base), detailTerms(conflict)).join(
                    ' · ',
                  ) ||
                    'No term differences; check the current status and availability.'}
                </p>
              )}
              <h4>Latest saved terms</h4>
              <p>
                {conflict.participants
                  .map((person) => person.displayName)
                  .join(', ')}{' '}
                · {conflict.status}
              </p>
              <ul>
                {conflict.items.map((entry) => (
                  <li key={entry.id}>
                    {conflict.participants.find(
                      (person) => person.userId === entry.ownerId,
                    )?.displayName ?? 'Member'}{' '}
                    gives {entry.titleSnapshot} to{' '}
                    {conflict.participants.find(
                      (person) => person.userId === entry.recipientId,
                    )?.displayName ?? 'Member'}{' '}
                    · {entry.conditionSnapshot} · {entry.descriptionSnapshot} ·{' '}
                    {entry.currentAvailability ?? 'Unavailable'}
                  </li>
                ))}
              </ul>
              <p>Expiry: {new Date(conflict.expiresAt).toLocaleString()}</p>
              {conflict.status === 'proposed' ? (
                <Button
                  onClick={() => {
                    setBase(conflict);
                    setNames((current) => ({
                      ...current,
                      ...Object.fromEntries(
                        conflict.participants.map((person) => [
                          person.userId,
                          person.displayName,
                        ]),
                      ),
                    }));
                    setConflict(null);
                    setReview(false);
                    setError(null);
                  }}
                >
                  Reuse draft and review latest version
                </Button>
              ) : (
                <p>These terms are read-only. Your draft cannot revise them.</p>
              )}
            </section>
          )}

          {review ? (
            <div className="proposal-content">
              <p>
                <strong>Meet to swap</strong> · {draft.participantIds.length}{' '}
                people
              </p>
              {revision && (
                <p>
                  Draft participants:{' '}
                  {draft.participantIds.map(displayName).join(', ')}. Saving
                  replaces version {base?.currentVersion} with this complete
                  draft, including any removed people or items.
                </p>
              )}
              <ul className="proposal-summary" aria-label="Trade transfers">
                {draft.transfers.map((transfer) => (
                  <li key={transfer.listingId}>
                    <strong>{displayName(transfer.ownerId)}</strong> gives{' '}
                    <strong>{titles[transfer.listingId] ?? 'Item'}</strong> to{' '}
                    <strong>{displayName(transfer.recipientId)}</strong>.
                    {revision && details[transfer.listingId] && (
                      <p>
                        {details[transfer.listingId]!.condition} ·{' '}
                        {details[transfer.listingId]!.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p>
                {revision
                  ? 'Every participant must agree to the revised version. The saved expiry is kept. Items are not reserved.'
                  : 'Invitations will be sent to the other participants. This proposal expires in seven days. Items are not reserved.'}
              </p>
              <div className="proposal-actions">
                <Button disabled={saving} onClick={() => setReview(false)}>
                  Edit draft
                </Button>
                <Button
                  variant="primary"
                  disabled={saving || !!conflict || needsRefresh}
                  onClick={() => void submit()}
                >
                  {saving
                    ? 'Sending…'
                    : revision
                      ? 'Save revision'
                      : 'Send proposal'}
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
                    {id !== selfId && (revision || id !== item!.ownerId) && (
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
                <div className="proposal-recipient" key={transfer.listingId}>
                  {revision && (
                    <Button
                      aria-label={`Remove item ${titles[transfer.listingId] ?? 'Item'}`}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          transfers: current.transfers.filter(
                            (entry) => entry.listingId !== transfer.listingId,
                          ),
                        }));
                        setError(null);
                      }}
                    >
                      Remove item
                    </Button>
                  )}
                  <span>
                    {displayName(transfer.ownerId)} gives{' '}
                    {titles[transfer.listingId] ?? 'Item'} to
                  </span>
                  <select
                    aria-label={`${displayName(transfer.ownerId)} gives ${titles[transfer.listingId] ?? 'Item'} to`}
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
                </div>
              ))}
              <p>
                <strong>Meet to swap</strong> is the default. After sending a
                proposal, you can invite someone for optional coffee in the swap
                details if you share at least two interests. Coffee requires
                separate consent.
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
