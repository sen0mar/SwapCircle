import { useEffect } from 'react';
import { ProposalMeetingDialog } from './ProposalMeetingDialog';
import type { useProposalResponse } from './useProposalResponses';

export function ProposalAcceptDialog({
  open,
  onOpenChange,
  respond,
  accepted,
  onCloseFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  respond: ReturnType<typeof useProposalResponse>['respond'];
  accepted: boolean;
  onCloseFocus: () => void;
}) {
  useEffect(() => {
    if (accepted && open) onOpenChange(false);
  }, [accepted, open, onOpenChange]);

  return (
    <ProposalMeetingDialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseFocus={onCloseFocus}
      title="Accept invite"
      pendingLabel="Accepting…"
      submitLabel="Accept and send meetup"
      pending={respond.isPending}
      saveError={respond.isError ? respond.error.message : undefined}
      onSave={(meeting) => respond.mutate({ action: 'accept', meeting })}
    />
  );
}
