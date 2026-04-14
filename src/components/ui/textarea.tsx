import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Apply error styling (red border) + aria-invalid. */
  error?: boolean;
}

/**
 * Multi-line text input primitive. Mirrors <Input> styling so
 * justification fields, memos, long-form notes all look the same.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        aria-invalid={error || undefined}
        className={cn(
          'flex w-full rounded-lg border bg-white/[0.03] px-3 py-2 text-sm ring-offset-background transition-colors',
          'placeholder:text-muted-foreground',
          'hover:border-white/[0.14]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 focus-visible:border-teal-400/40',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'resize-y min-h-[80px]',
          error ? 'border-red-500/40' : 'border-input',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
