import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import type { TradeDetail } from './trades-api';
import { useAcceptTrade, useTrade } from './useTrades';

export function TradeAcceptance({ detail }: { detail: TradeDetail }) {
  const { session } = useAuth();
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreAcceptanceFocus = useRef(false);
  const trade = useTrade(detail.id);
  const acceptance = useAcceptTrade(detail.id);
  const [review, setReview] = useState<{
    terms: TradeDetail;
    operationKey: string;
  } | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState(false);
  const self = detail.participants.find((p) => p.userId === session?.user.id);
  const accepted = self?.acceptedVersion === detail.currentVersion;
  const unavailable = detail.items.some(
    (i) => i.currentAvailability !== 'available',
  );
  const changed =
    review && review.terms.currentVersion !== detail.currentVersion;
  const error = acceptance.error;
  const rejected =
    error instanceof ApiError &&
    error.status !== undefined &&
    error.status < 500;

  useEffect(() => {
    if (accepted && restoreAcceptanceFocus.current) {
      restoreAcceptanceFocus.current = false;
      heading.current?.focus();
    }
  }, [accepted]);

  async function reviewCurrent() {
    setReading(true);
    setReadError(false);
    const fresh = await trade.refetch();
    setReading(false);

    if (fresh.isError || !fresh.data) {
      setReadError(true);
      return;
    }

    acceptance.reset();
    setReview({ terms: fresh.data, operationKey: crypto.randomUUID() });
  }

  if (detail.status === 'confirmed')
    return (
      <section
        className="panel route-panel trade-acceptance"
        aria-label="Agreement"
      >
        <h2 ref={heading} tabIndex={-1}>
          Agreement confirmed
        </h2>
        <p role="status">
          Everyone accepted version {detail.currentVersion}. Items are reserved
          for this swap.
        </p>
        <p>
          This confirms the agreement, not physical handover or receipt of
          items.
        </p>
      </section>
    );

  if (detail.status !== 'proposed' || !self) return null;

  return (
    <section
      className="panel route-panel trade-acceptance"
      aria-label="Agreement"
    >
      <h2 ref={heading} tabIndex={-1}>
        Agree to current terms
      </h2>
      <p role="status">
        {
          detail.participants.filter(
            (p) => p.acceptedVersion === detail.currentVersion,
          ).length
        }{' '}
        of {detail.participantCount} participants accepted version{' '}
        {detail.currentVersion}.
        {accepted
          ? ' Your acceptance is saved. Waiting for the other participants.'
          : ' Your acceptance is pending.'}
      </p>
      <p>
        Items are reserved only when everyone accepts and the server confirms
        availability. Chat membership is separate.
      </p>
      {unavailable && (
        <p role="alert">
          An item is no longer available, possibly reserved by another swap.
          This proposal cannot confirm with these items. Your terms and history
          remain below.
        </p>
      )}
      {readError && (
        <p role="alert">
          Current terms could not be refreshed. Retry review before accepting.
        </p>
      )}
      {error && !accepted && (
        <p role="alert">
          {error instanceof ApiError && error.code === 'STALE_PROPOSAL'
            ? 'The terms changed. Your reviewed version remains below. Review the latest version before accepting again.'
            : error instanceof ApiError && error.code === 'LISTING_UNAVAILABLE'
              ? 'An item became unavailable. This acceptance could not be saved. Review current availability below.'
              : error instanceof ApiError && error.code === 'PROPOSAL_EXPIRED'
                ? 'The server reports this proposal has expired. These terms can no longer be accepted.'
                : rejected
                  ? 'These terms cannot currently be accepted. Refresh and review the current proposal.'
                  : 'Acceptance could not be verified. Your review is preserved. Retry the same acceptance or refresh to check its outcome.'}
        </p>
      )}
      {changed && (
        <p role="alert">
          You reviewed version {review.terms.currentVersion}; the current
          version is {detail.currentVersion}. Review the latest terms before
          accepting.
        </p>
      )}
      {!accepted && (
        <Button
          onClick={() => void reviewCurrent()}
          disabled={reading || acceptance.isPending}
        >
          {reading ? 'Refreshing terms…' : 'Review current terms'}
        </Button>
      )}
      {review && (
        <section className="acceptance-review" aria-label="Acceptance review">
          <h3>Review version {review.terms.currentVersion}</h3>
          <p>
            Meet to swap · {review.terms.participantCount} participants ·
            Expires {new Date(review.terms.expiresAt).toLocaleString()}
          </p>
          {(['give', 'receive'] as const).map((direction) => (
            <div key={direction}>
              <h4>You {direction}</h4>
              <ul>
                {review.terms.items
                  .filter(
                    (item) =>
                      (direction === 'give'
                        ? item.ownerId
                        : item.recipientId) === session?.user.id,
                  )
                  .map((item) => (
                    <li key={item.id}>
                      {item.titleSnapshot}{' '}
                      {direction === 'give' ? 'to' : 'from'}{' '}
                      {review.terms.participants.find(
                        (p) =>
                          p.userId ===
                          (direction === 'give'
                            ? item.recipientId
                            : item.ownerId),
                      )?.displayName ?? 'Member'}
                      <p>
                        {item.conditionSnapshot} · {item.descriptionSnapshot}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p>
            Accepting applies only to this exact version. It does not confirm
            handover.
          </p>
          {!accepted && (
            <Button
              variant="primary"
              disabled={
                !!changed ||
                unavailable ||
                rejected ||
                readError ||
                reading ||
                trade.isError ||
                acceptance.isPending ||
                detail.status !== review.terms.status
              }
              onClick={() => {
                restoreAcceptanceFocus.current = true;
                acceptance.mutate({
                  expectedVersion: review.terms.currentVersion,
                  operationKey: review.operationKey,
                });
              }}
            >
              {acceptance.isPending
                ? 'Saving acceptance…'
                : `Accept version ${review.terms.currentVersion}`}
            </Button>
          )}
        </section>
      )}
      <Button
        variant="secondary"
        disabled={reading || acceptance.isPending}
        onClick={() => void trade.refetch()}
      >
        Refresh agreement
      </Button>
    </section>
  );
}
