'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PasswordFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Initial visibility. Default false (masked). */
  defaultVisible?: boolean;
}

/**
 * Password-style input with a show/hide eye toggle. Always renders with
 * `type="password"` by default. Pairs with a plaintext reveal button so
 * users can verify a long secret before submitting without having to
 * retype it.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ className, defaultVisible = false, autoComplete = 'new-password', ...props }, ref) => {
    const [visible, setVisible] = useState(defaultVisible);
    return (
      <div className={cn('relative', className)}>
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="pr-10 font-mono"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
          )}
          aria-label={visible ? 'Hide secret' : 'Show secret'}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  },
);
PasswordField.displayName = 'PasswordField';
