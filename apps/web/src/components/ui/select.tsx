import type { ComponentProps } from 'react';
import { ExpandIcon } from './icons';

export function Select({
  className = '',
  disabled,
  ...props
}: ComponentProps<'select'>) {
  return (
    <span className="native-select">
      <select
        className={`native-select-control ${className}`}
        disabled={disabled}
        {...props}
      />
      <ExpandIcon className="native-select-arrow" aria-hidden="true" />
    </span>
  );
}
