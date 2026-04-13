'use client';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Confirm button treatment:
   *   'primary'     — gradient Tier 1 pill (safe state changes: Go Live, Save, Enter Test Mode)
   *   'destructive' — solid red (irreversible actions, typically paired with requireText)
   *   'default'     — solid L1 teal (legacy; prefer 'primary' for new safe confirms)
   */
  variant?: 'destructive' | 'default' | 'primary';
  isPending?: boolean;
  onConfirm: () => void;
  /**
   * When set, requires the user to type this exact string before the
   * confirm button enables. Raises the friction floor for irreversible
   * actions on active resources (e.g. deactivating a live ERP
   * integration).
   */
  requireText?: string;
  /** Optional helper above the typed-confirm input. */
  requireHelper?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'destructive',
  isPending = false,
  onConfirm,
  requireText,
  requireHelper,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  // Reset typed state whenever the dialog toggles so re-opening starts clean.
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const typeOk = !requireText || typed.trim() === requireText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireText && (
          <div className="space-y-2">
            {requireHelper && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {requireHelper}
              </p>
            )}
            <Label className="text-xs">
              Type <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{requireText}</code> to confirm
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              autoFocus
              className="font-mono"
              disabled={isPending}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isPending || !typeOk}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {confirmLabel}…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
