'use client';
import { Calendar } from 'lucide-react';

export function SchedulePaymentForm() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-5 py-4">
      <Calendar className="h-4 w-4 text-amber-400 shrink-0" />
      <div>
        <p className="text-sm font-medium text-white/80">Schedule payments</p>
        <p className="text-xs text-muted-foreground">Coming soon — for now, use Send Payment for immediate transfers.</p>
      </div>
    </div>
  );
}
