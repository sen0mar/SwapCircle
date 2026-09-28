import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReportSubmission } from '@swapcircle/contracts';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { useAuth } from '../auth/AuthProvider';
import { actionError } from './action-error';
import { useReport, useSafetyStatus, useSetBlock } from './useSafety';

export function BlockAction({
  userId,
  name,
  blocked,
  returnFocusId,
}: {
  userId: string;
  name: string;
  blocked: boolean;
  returnFocusId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [intendedBlock, setIntendedBlock] = useState(!blocked);
  const mutation = useSetBlock();
  const label = blocked ? 'Unblock member' : 'Block member';

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!mutation.isPending) {
          if (value) setIntendedBlock(!blocked);
          setOpen(value);
          mutation.reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">{label}</Button>
      </DialogTrigger>
      <DialogContent
        closeDisabled={mutation.isPending}
        onCloseAutoFocus={(event) => {
          if (returnFocusId) {
            event.preventDefault();
            document.getElementById(returnFocusId)?.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
      >
        <DialogTitle>
          {intendedBlock ? 'Block' : 'Unblock'} {name}?
        </DialogTitle>
        <DialogDescription>
          {!intendedBlock
            ? 'Remove your block on this member. Other contact restrictions may still apply.'
            : 'This prevents direct messages and new joint trade or coffee invitations in either direction. Public listings remain visible.'}
        </DialogDescription>
        {mutation.isError && <p role="alert">{actionError(mutation.error)}</p>}
        <div className="safety-dialog-actions">
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                { userId, blocked: intendedBlock },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {mutation.isPending
              ? 'Saving block preference…'
              : `Confirm ${intendedBlock ? 'block' : 'unblock'}`}
          </Button>
        </div>
        {mutation.isPending && <p role="status">Saving block preference…</p>}
      </DialogContent>
    </Dialog>
  );
}

function ReportAction({
  targetType,
  targetId,
}: Pick<ReportSubmission, 'targetType' | 'targetId'>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submission, setSubmission] = useState<ReportSubmission | null>(null);
  const mutation = useReport();
  const id = useId();
  const reset = () => {
    setReason('');
    setSubmission(null);
    mutation.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return;
        setOpen(value);
        if (!value && mutation.isSuccess) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          Report {targetType === 'member' ? 'member' : 'item'}
        </Button>
      </DialogTrigger>
      <DialogContent
        closeDisabled={mutation.isPending}
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
      >
        <DialogTitle>
          Report {targetType === 'member' ? 'member' : 'item'}
        </DialogTitle>
        <DialogDescription>
          Describe the concern. Your report is private and does not
          automatically restrict another account. Avoid including private
          contact or meeting details.
        </DialogDescription>
        {mutation.isSuccess ? (
          <p role="status" className="safety-report-receipt">
            Report received. Reference: {mutation.data.id}
          </p>
        ) : (
          <form
            className="safety-report-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (mutation.isPending || !reason.trim()) return;
              const input = submission ?? {
                clientReportId: crypto.randomUUID(),
                targetType,
                targetId,
                reason: reason.trim(),
              };
              setSubmission(input);
              mutation.mutate(input);
            }}
          >
            <label htmlFor={id}>Reason for reporting</label>
            <textarea
              id={id}
              required
              maxLength={2000}
              rows={5}
              value={reason}
              disabled={!!submission}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby={`${id}-help`}
            />
            <p id={`${id}-help`}>
              {submission
                ? 'Retry sends the same details and reference to avoid duplicate reports. Start a different report to edit the details.'
                : 'Up to 2,000 characters.'}
            </p>
            {mutation.isError && (
              <p role="alert">{actionError(mutation.error)}</p>
            )}
            <div className="safety-dialog-actions">
              <Button
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={mutation.isPending || !reason.trim()}
              >
                {mutation.isPending
                  ? 'Sending report…'
                  : submission
                    ? 'Retry report'
                    : 'Submit report'}
              </Button>
            </div>
            {submission && !mutation.isPending && (
              <Button variant="ghost" onClick={reset}>
                Start a different report
              </Button>
            )}
            {mutation.isPending && <p role="status">Sending report…</p>}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RestrictionNotice() {
  const { session } = useAuth();
  const status = useSafetyStatus();
  if (!session || !status.data?.restricted) return null;
  return (
    <p role="status">
      Changes and new contact are currently unavailable for your account. You
      can still manage blocks and submit reports.
    </p>
  );
}

export function SafetyActions({
  userId,
  name,
  targetType,
  targetId,
}: { userId: string; name: string } & Pick<
  ReportSubmission,
  'targetType' | 'targetId'
>) {
  const { session, loading } = useAuth();
  const status = useSafetyStatus(userId);
  if (loading || session?.user.id === userId) return null;

  return (
    <section className="safety-actions" aria-label="Safety actions">
      <h2>Safety</h2>
      {!session ? (
        <p>
          <Link
            to={`/sign-in?next=${encodeURIComponent(targetType === 'member' ? `/members/${targetId}` : `/listings/${targetId}`)}`}
          >
            Sign in
          </Link>{' '}
          to block or report.
        </p>
      ) : (
        <>
          {status.isPending ? (
            <p role="status">Loading block preference…</p>
          ) : status.isError ? (
            <div>
              <p role="alert">Your block preference could not be loaded.</p>
              <Button variant="secondary" onClick={() => void status.refetch()}>
                Retry block preference
              </Button>
            </div>
          ) : (
            <>
              {status.data.restricted && (
                <p>
                  Changes and new contact are currently unavailable for your
                  account. Safety controls remain available.
                </p>
              )}
              {status.data.ownBlocked && (
                <p role="status">
                  You have blocked this member. Direct contact and new joint
                  invitations are unavailable.
                </p>
              )}
              <BlockAction
                userId={userId}
                name={name}
                blocked={status.data.ownBlocked}
              />
            </>
          )}
          <ReportAction
            key={`${targetType}:${targetId}`}
            targetType={targetType}
            targetId={targetId}
          />
        </>
      )}
    </section>
  );
}
