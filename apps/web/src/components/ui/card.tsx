import type { ComponentProps } from 'react';

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return <div className={`ui-card ${className}`} {...props} />;
}
