import { CheckCircle2, X } from 'lucide-react';
import { Button } from './button';

export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="ui-toast">
      <CheckCircle2
        size={20}
        className="text-state-success"
        aria-hidden="true"
      />
      <p role="status">{message}</p>
      <Button
        variant="ghost"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={18} aria-hidden="true" />
      </Button>
    </div>
  );
}
