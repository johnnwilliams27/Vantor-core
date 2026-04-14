import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputSize = 'sm' | 'default' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Input height: sm h-9 (36px) · default h-10 (40px) · lg h-11 (44px). */
  inputSize?: InputSize;
  /** Icon rendered inside the left edge — search magnifier, currency symbol, etc. */
  leadingIcon?: React.ReactNode;
  /** Icon rendered inside the right edge — typically an interactive element (eye toggle). */
  trailingIcon?: React.ReactNode;
  /** Callback for trailing icon click — if omitted, trailingIcon is decorative. */
  onTrailingClick?: () => void;
  /** Apply error styling (red border) + aria-invalid. */
  error?: boolean;
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-9 text-xs',
  default: 'h-10 text-sm',
  lg: 'h-11 text-sm',
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputSize = 'default', leadingIcon, trailingIcon, onTrailingClick, error, ...props }, ref) => {
    const inputEl = (
      <input
        type={type}
        aria-invalid={error || undefined}
        className={cn(
          'flex w-full rounded-lg border bg-white/[0.03] px-3 py-2 ring-offset-background transition-colors',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-muted-foreground',
          'hover:border-white/[0.14]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 focus-visible:border-teal-400/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          SIZE_CLASSES[inputSize],
          error ? 'border-red-500/40' : 'border-input',
          leadingIcon && 'pl-9',
          trailingIcon && 'pr-9',
          className
        )}
        ref={ref}
        {...props}
      />
    );

    if (!leadingIcon && !trailingIcon) return inputEl;

    return (
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&>svg]:w-3.5 [&>svg]:h-3.5">
            {leadingIcon}
          </span>
        )}
        {inputEl}
        {trailingIcon && (
          onTrailingClick ? (
            <button
              type="button"
              onClick={onTrailingClick}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-white/[0.05] text-muted-foreground hover:text-foreground [&>svg]:w-3.5 [&>svg]:h-3.5"
              tabIndex={-1}
            >
              {trailingIcon}
            </button>
          ) : (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground [&>svg]:w-3.5 [&>svg]:h-3.5">
              {trailingIcon}
            </span>
          )
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
