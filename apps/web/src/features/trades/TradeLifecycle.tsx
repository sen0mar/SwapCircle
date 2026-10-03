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
import { hasHandover, lifecycleSummary } from './lifecycle-copy';
import { useTrade, useTradeTransition } from './useTrades';

export function TradeLifecycle({
  detail,
  current,
}: {
  detail: TradeDetail;
  current: boolean;
}) {
  const trade = useTrade(detail.id);
  const transition = useTradeTransition(detail.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [review, setReview] = useState<{
    action: 'decline' | 'cancel';
    version: number;
    status: TradeDetail['status'];
  } | null>(null);
  const terminal = lifecycleSummary(detail.status);
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

  return (
    <section
      className="panel route-panel trade-lifecycle"
      aria-label="Swap lifecycle"
    >
      <h2 ref={heading} tabIndex={-1}>
        {terminal ? 'Closed swap' : 'Swap actions'}
      </h2>
      {terminal && <p role="status">{terminal}</p>}
      {protectedHandover && (
        <p>
          Cancellation is unavailable after a receipt, handover, or dispute is
          recorded. Items are not released.
        </p>
      )}
      {permitted && (
        <>
          <p>
            {detail.status === 'confirmed'
              ? 'Cancel only before any handover or receipt has been reported. The server checks this before releasing reservations.'
              : 'Declining or cancelling closes this proposal for everyone. It keeps the terms and history.'}
          </p>
          <p>
            Coffee consent has its own controls below. Cancelling coffee leaves
            the swap unchanged.
          </p>
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
        </>
      )}
      <Button
        disabled={transition.isPending}
        onClick={() => void trade.refetch()}
      >
        Refresh swap status
      </Button>
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
              ? ' Reservations are released only if the server confirms cancellation before any reported handover or receipt.'
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
