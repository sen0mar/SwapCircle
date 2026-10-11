import type { ComponentProps } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CloseIcon } from './icons';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({
  children,
  className = '',
  presentation = 'dialog',
  closeDisabled = false,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  presentation?: 'dialog' | 'sheet';
  closeDisabled?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content
        className={`ui-modal ui-${presentation} ${className}`}
        {...props}
      >
        <DialogPrimitive.Close asChild>
          <Button
            variant="ghost"
            className="ui-modal-close"
            aria-label="Close"
            disabled={closeDisabled}
          >
            <CloseIcon size={20} aria-hidden="true" />
          </Button>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
