import { Select } from '../../components/ui/select';
import { useRef, useState } from 'react';
import type {
  TradeProblemSubmission,
  TradeReceiptSubmission,
} from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/AuthProvider';
import type { TradeDetail } from './trades-api';
import { useTradeOutcome } from './useTrades';

type Submission = {
  action: 'receipt' | 'problem';
  input: TradeReceiptSubmission | TradeProblemSubmission;
};

export function TradeCompletion({
  detail,
  current,
}: {
  detail: TradeDetail;
  current: boolean;
}) {
  const { session } = useAuth();
  const outcome = useTradeOutcome(detail.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [review, setReview] = useState<{
    action: 'receipt' | 'problem';
    version: number;
  } | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [kind, setKind] = useState<TradeProblemSubmission['kind']>('problem');
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState('');
  const receipts = new Set(
    detail.events
      .filter(
        (event) =>
          event.eventType === 'receipt_acknowledged' &&
          event.version === detail.currentVersion,
      )
      .map((event) => event.actorId),
  );
  const acknowledged = receipts.has(session?.user.id ?? '');
  const active = detail.status === 'confirmed' || detail.status === 'disputed';
  const rejected =
    outcome.error instanceof ApiError &&
    outcome.error.status !== undefined &&
    outcome.error.status < 500;
  const changed = review?.version !== detail.currentVersion || !active;

  function open(action: 'receipt' | 'problem', button: HTMLButtonElement) {
    trigger.current = button;
    setSaved('');
    if (!submission) outcome.reset();
    setReview({
      action,
      version: submission?.input.expectedVersion ?? detail.currentVersion,
    });
  }

  function submit() {
    if (!review) return;
    const next = submission ?? {
      action: review.action,
      input:
        review.action === 'problem'
          ? {
              operationKey: crypto.randomUUID(),
              expectedVersion: review.version,
              kind,
              reason: reason.trim(),
            }
          : {
              operationKey: crypto.randomUUID(),
              expectedVersion: review.version,
            },
    };
    setSubmission(next);
    outcome.mutate(next, {
      onSuccess: () => {
        setSaved(
          next.action === 'problem'
            ? 'Your private report was submitted. The dispute is unresolved.'
            : 'Your receipt acknowledgement was saved.',
        );
        setSubmission(null);
        setReason('');
        setReview(null);
      },
    });
  }

  if (!active && detail.status !== 'completed' && !submission && !review)
    return null;

  return (
    <section
      className="panel route-panel trade-lifecycle"
      aria-label="Receipt and problems"
    >
      <h2 ref={heading} tabIndex={-1}>
        {detail.status === 'completed'
          ? 'Swap completed'
          : detail.status === 'disputed'
            ? 'Dispute unresolved'
            : receipts.size
              ? 'Waiting for receipts'
              : 'Confirm your receipt'}
      </h2>
      <p>
        Accepting the terms confirms agreement, not delivery. Each participant
        records only their own receipt after receiving all items due to them.
      </p>
      <ul>
        {detail.participants.map((person) => (
          <li key={person.userId}>
            {person.displayName}
            {person.userId === session?.user.id ? ' (you)' : ''} ·{' '}
            {receipts.has(person.userId)
              ? 'Receipt acknowledged'
              : 'Receipt pending'}
          </li>
        ))}
      </ul>
      {detail.status === 'confirmed' && (
        <p>
          {receipts.size} of {detail.participants.length} receipts acknowledged.
          The swap completes only when everyone acknowledges; items stay
          reserved until then.
        </p>
      )}
      {detail.status === 'disputed' && (
        <p>
          A report does not resolve the dispute. Items stay reserved. You may
          still record your own receipt as evidence, but this will not complete
          or resolve the disputed swap. Private report review and dispute
          resolution are not available yet.
        </p>
      )}
      {detail.status === 'completed' && (
        <p>
          Everyone acknowledged receipt. Items are exchanged. Cancellation and
          new problem reports are unavailable after completion; a review process
          is not available yet.
        </p>
      )}
      <p>
        Report details are private and are not shared in participant history or
        notifications. Report submission is not a promise of review or
        resolution.
      </p>
      {saved && <p role="status">{saved}</p>}
      {active && !submission && (
        <div className="notification-actions">
          <Button
            disabled={!current || acknowledged || outcome.isPending}
            onClick={(event) => open('receipt', event.currentTarget)}
          >
            {acknowledged
              ? 'Your receipt is acknowledged'
              : 'Confirm my receipt'}
          </Button>
          <Button
            disabled={!current || outcome.isPending}
            onClick={(event) => open('problem', event.currentTarget)}
          >
            Report a problem
          </Button>
        </div>
      )}
      {!current && (
        <p role="alert">
          Current status could not be verified. Refresh the swap before starting
          a new action.
        </p>
      )}
      {submission && !review && (
        <>
          <p role="status">
            Your original submission is saved. Reopen it to verify the same
            action without creating a duplicate.
          </p>
          <Button
            onClick={(event) => open(submission.action, event.currentTarget)}
          >
            Review saved submission
          </Button>
        </>
      )}
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !outcome.isPending) setReview(null);
        }}
      >
        <DialogContent
          className="trade-lifecycle-dialog"
          closeDisabled={outcome.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
            else heading.current?.focus();
          }}
        >
          <DialogTitle>
            {review?.action === 'problem'
              ? 'Submit a private problem report'
              : 'Confirm your own receipt?'}
          </DialogTitle>
          <DialogDescription>
            {review?.action === 'problem'
              ? 'This records a problem and protects the reserved items. It does not resolve the dispute or release items. Private review and resolution are not available yet.'
              : 'Confirm only after receiving all items due to you in these terms. You cannot acknowledge for anyone else. A disputed swap will remain disputed.'}
          </DialogDescription>
          {review?.action === 'problem' && (
            <>
              <label htmlFor="problem-kind">Problem type</label>
              <Select
                id="problem-kind"
                value={kind}
                disabled={!!submission}
                onChange={(event) =>
                  setKind(event.target.value as TradeProblemSubmission['kind'])
                }
              >
                <option value="problem">Problem with the swap</option>
                <option value="partial_handover">Partial handover</option>
              </Select>
              <label htmlFor="problem-reason">Private report details</label>
              <textarea
                id="problem-reason"
                value={reason}
                maxLength={2000}
                disabled={!!submission}
                aria-describedby="problem-privacy"
                onChange={(event) => setReason(event.target.value)}
              />
              <p id="problem-privacy">
                Only the private report stores these details. Other participants
                see that a problem was reported, without this text.
              </p>
            </>
          )}
          {!submission && (changed || !current) && (
            <p role="alert">
              The swap changed or its current status is unavailable. Close this
              dialog, refresh, and review before submitting.
            </p>
          )}
          {outcome.error && (
            <p role="alert">
              {rejected
                ? 'This submission was rejected. Close and refresh to review the current swap. You can discard the rejected submission before starting another.'
                : 'The outcome could not be verified. Your original details are saved. Retry this same submission, even if another tab changed the swap.'}
            </p>
          )}
          <div className="notification-actions">
            <Button
              disabled={outcome.isPending}
              onClick={() => setReview(null)}
            >
              Go back
            </Button>
            {rejected && (
              <Button
                onClick={() => {
                  setSubmission(null);
                  outcome.reset();
                  setReview(null);
                }}
              >
                Discard rejected submission
              </Button>
            )}
            <Button
              variant="primary"
              disabled={
                outcome.isPending ||
                rejected ||
                (!submission &&
                  (changed ||
                    !current ||
                    (review?.action === 'problem' && !reason.trim())))
              }
              onClick={submit}
            >
              {outcome.isPending
                ? 'Checking and saving…'
                : submission
                  ? 'Retry same submission'
                  : review?.action === 'problem'
                    ? 'Submit private report'
                    : 'I received all my items'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
