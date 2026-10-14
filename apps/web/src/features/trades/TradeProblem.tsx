import { Select } from '../../components/ui/select';
import { useRef, useState } from 'react';
import type { TradeProblemSubmission } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { ApiError } from '../../lib/api-client';
import type { TradeDetail } from './trades-api';
import { useTradeProblem } from './useTrades';

export function TradeProblem({
  detail,
  current,
}: {
  detail: TradeDetail;
  current: boolean;
}) {
  const outcome = useTradeProblem(detail.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [review, setReview] = useState<{
    version: number;
  } | null>(null);
  const [submission, setSubmission] = useState<TradeProblemSubmission | null>(
    null,
  );
  const [kind, setKind] = useState<TradeProblemSubmission['kind']>('problem');
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState('');
  const active = detail.status === 'confirmed' || detail.status === 'disputed';
  const rejected =
    outcome.error instanceof ApiError &&
    outcome.error.status !== undefined &&
    outcome.error.status < 500;
  const changed = review?.version !== detail.currentVersion || !active;

  function open(button: HTMLButtonElement) {
    trigger.current = button;
    setSaved('');
    if (!submission) outcome.reset();
    setReview({
      version: submission?.expectedVersion ?? detail.currentVersion,
    });
  }

  function submit() {
    if (!review) return;
    const next = submission ?? {
      operationKey: crypto.randomUUID(),
      expectedVersion: review.version,
      kind,
      reason: reason.trim(),
    };
    setSubmission(next);
    outcome.mutate(next, {
      onSuccess: () => {
        setSaved(
          'Your private report was submitted. The dispute is unresolved.',
        );
        setSubmission(null);
        setReason('');
        setReview(null);
      },
    });
  }

  if (!active && !submission && !review) return null;

  return (
    <section className="swap-report-action" aria-label="Problems">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        Report a problem
      </h2>
      {saved && <p role="status">{saved}</p>}
      {active && !submission && (
        <div className="notification-actions">
          <Button
            disabled={!current || outcome.isPending}
            onClick={(event) => open(event.currentTarget)}
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
          <Button onClick={(event) => open(event.currentTarget)}>
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
          <DialogTitle>Submit a private problem report</DialogTitle>
          <DialogDescription>
            This records a problem and protects the reserved items. It does not
            resolve the dispute or release items. Private review and resolution
            are not available yet.
          </DialogDescription>
          {review && (
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
                (!submission && (changed || !current || !reason.trim()))
              }
              onClick={submit}
            >
              {outcome.isPending
                ? 'Checking and saving…'
                : submission
                  ? 'Retry same submission'
                  : 'Submit private report'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
