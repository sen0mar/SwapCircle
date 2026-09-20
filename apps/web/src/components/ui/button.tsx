import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';

export function Button({
  asChild = false,
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'> & {
  asChild?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      type={asChild ? undefined : type}
      className={`ui-button ui-button-${variant} ${className}`}
      {...props}
    />
  );
}
