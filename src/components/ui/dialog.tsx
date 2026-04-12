'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

const DialogCloseContext = React.createContext<(() => void) | null>(null);

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  if (!open || !mounted) return null;

  return createPortal(
    <DialogCloseContext.Provider value={() => onOpenChange(false)}>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        <div
          className="fixed inset-0 bg-black/50"
          onClick={() => onOpenChange(false)}
        />
        <div className="relative z-[9999] w-full max-w-lg mx-4">{children}</div>
      </div>
    </DialogCloseContext.Provider>,
    document.body
  );
}

export function DialogContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative bg-background rounded-lg shadow-xl p-6 mx-4',
        className
      )}
      {...props}
    >
      {children}
      <DialogCloseX />
    </div>
  );
}

function DialogCloseX() {
  const close = React.useContext(DialogCloseContext);
  if (!close) return null;
  return (
    <button
      onClick={close}
      className="absolute top-4 right-4 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label="Close"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2', className)} {...props} />
  );
}
