import type { ComponentProps } from 'react';

// Associate the persistent id with the input's aria-describedby.
export function FormFeedback({
  tone = 'hint',
  className = '',
  ...props
}: ComponentProps<'p'> & { id: string; tone?: 'hint' | 'error' | 'status' }) {
  return (
    <p
      role={
        tone === 'error' ? 'alert' : tone === 'status' ? 'status' : undefined
      }
      className={`ui-feedback ui-feedback-${tone} ${className}`}
      {...props}
    />
  );
}
