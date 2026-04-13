import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Form field wrapper — label + input + helper/error. See style guide Section 06.
 *
 * Pairs with Input/Select/Textarea to compose a complete field unit.
 * Handles label placement, required marker, helper text, and error
 * messaging consistently so callers don't re-build this layout.
 */
interface FieldProps {
  /** Visible label text above the input. */
  label?: React.ReactNode;
  /** Show an amber asterisk next to the label for required fields. */
  required?: boolean;
  /** Show "(optional)" next to the label. Mutually exclusive with required. */
  optional?: boolean;
  /** Helper text below the input — shown in text-muted when no error. */
  helper?: React.ReactNode;
  /** Error message — replaces helper and sets red border via aria-invalid */
  error?: React.ReactNode;
  /** The input, select, textarea, or other field control. */
  children: React.ReactNode;
  /** Optional id to link label + input for a11y. */
  htmlFor?: string;
  className?: string;
}

export function Field({
  label,
  required,
  optional,
  helper,
  error,
  children,
  htmlFor,
  className,
}: FieldProps) {
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;
  const helperId = helper && htmlFor && !error ? `${htmlFor}-helper` : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-foreground flex items-baseline gap-1"
        >
          <span>{label}</span>
          {required && (
            <span className="text-amber-400" aria-hidden="true">
              *
            </span>
          )}
          {optional && !required && (
            <span className="text-muted-foreground text-[10px] font-normal">
              (optional)
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-[11px] text-red-400 flex items-center gap-1"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-3 h-3 shrink-0"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </p>
      ) : helper ? (
        <p id={helperId} className="text-[11px] text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
