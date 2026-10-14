import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { ApiError } from '../../lib/api-client';
import type { TradeDetail } from './trades-api';
import { hasHandover } from './lifecycle-copy';
import { useTradeTransition } from './useTrades';

export function TradeLifecycle({
  detail,
  current,
}: {
  detail: TradeDetail;
  current: boolean;
}) {
  const transition = useTradeTransition(detail.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [review, setReview] = useState<{
    action: 'decline' | 'cancel';
    version: number;
    status: TradeDetail['status'];
  } | null>(null);
  const protectedHandover = hasHandover(detail);
  const permitted = ['proposed', 'confirmed'].includes(detail.status);
  const changed =
    review &&
    (review.version !== detail.currentVersion ||
      review.status !== detail.status);
  const error = transition.error;
  const rejected =
    error instanceof ApiError &&
    error.status !== undefined &&
    error.status < 500;

  function open(action: 'decline' | 'cancel') {
    transition.reset();
    setReview({
      action,
      version: detail.currentVersion,
      status: detail.status,
    });
  }

  if (!permitted || protectedHandover) return null;

  return (
    <section className="swap-lifecycle-actions" aria-label="Swap lifecycle">
      <h2 ref={heading} tabIndex={-1} className="sr-only">
        Swap actions
      </h2>
      <div className="notification-actions">
        {detail.status === 'proposed' && (
          <Button
            disabled={!current || protectedHandover || transition.isPending}
            onClick={(event) => {
              trigger.current = event.currentTarget;
              open('decline');
            }}
          >
            Decline proposal
          </Button>
        )}
        <Button
          disabled={!current || protectedHandover || transition.isPending}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            open('cancel');
          }}
        >
          {detail.status === 'confirmed'
            ? 'Cancel confirmed swap'
            : 'Cancel proposal'}
        </Button>
      </div>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !transition.isPending) setReview(null);
        }}
      >
        <DialogContent
          className="trade-lifecycle-dialog"
          closeDisabled={transition.isPending}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
            else heading.current?.focus();
          }}
        >
          <DialogTitle>
            {review?.action === 'decline'
              ? 'Decline this proposal?'
              : 'Cancel this swap?'}
          </DialogTitle>
          <DialogDescription>
            This closes version {review?.version} for all participants and
            preserves its history.
            {review?.status === 'confirmed'
              ? ' Reservations are released only if the server confirms cancellation before any reported exchange or problem.'
              : ' No items are reserved by this proposal.'}{' '}
            This does not mark any items as received or exchanged.
          </DialogDescription>
          {changed && (
            <p role="alert">
              The swap changed since you opened this confirmation. Close it and
              review the current status before acting.
            </p>
          )}
          {!current && (
            <p role="alert">
              Current status could not be verified. Refresh the swap before
              acting.
            </p>
          )}
          {error && (
            <p role="alert">
              {error instanceof ApiError && error.code === 'HANDOVER_RECORDED'
                ? 'A handover has been recorded. Cancellation is not permitted and items have not been released.'
                : rejected
                  ? 'The swap changed or this action is no longer permitted. Close this confirmation, refresh, and review the current status.'
                  : 'The outcome could not be verified. Items are not shown as available until the server confirms their state. Retry the same action or refresh the swap.'}
            </p>
          )}
          <div className="notification-actions">
            <Button
              disabled={transition.isPending}
              onClick={() => setReview(null)}
            >
              Go back
            </Button>
            <Button
              variant="primary"
              disabled={
                !review ||
                !!changed ||
                !current ||
                protectedHandover ||
                rejected ||
                transition.isPending
              }
              onClick={() => {
                if (!review) return;
                transition.mutate(
                  {
                    action: review.action,
                    expectedVersion: review.version,
                    expectedStatus:
                      review.status === 'confirmed' ? 'confirmed' : 'proposed',
                  },
                  { onSuccess: () => setReview(null) },
                );
              }}
            >
              {transition.isPending
                ? 'Checking and saving…'
                : review?.action === 'decline'
                  ? 'Confirm decline'
                  : 'Confirm cancellation'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
