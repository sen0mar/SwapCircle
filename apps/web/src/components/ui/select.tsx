import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';

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
      <ChevronDown className="native-select-arrow" aria-hidden="true" />
    </span>
  );
}
