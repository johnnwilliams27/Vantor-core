'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface CancelDetail {
  label: string;
  value: string;
}

interface CancelScheduledDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  details: CancelDetail[];
  onConfirm: () => void;
  isPending: boolean;
}

export function CancelScheduledDialog({
  open,
  onOpenChange,
  title,
  details,
  onConfirm,
  isPending,
}: CancelScheduledDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel this scheduled operation?
          </p>
          <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
            {details.map((d) => (
              <div key={d.label} className="flex justify-between">
                <span className="text-muted-foreground">{d.label}</span>
                <span className="font-medium">{d.value}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">This action cannot be undone.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button onClick={() => onOpenChange(false)}>Go Back</Button>
          <Button
            variant="outline"
            className="text-red-400 border-red-500/20 hover:bg-red-500/10"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? 'Cancelling\u2026' : 'Confirm Cancel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
