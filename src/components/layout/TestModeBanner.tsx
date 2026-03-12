'use client';
import { useAppStore } from '@/store/appStore';
import { FlaskConical } from 'lucide-react';

export function TestModeBanner() {
  const testMode = useAppStore((s) => s.testMode);

  if (!testMode) return null;

  return (
    <div className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 text-center text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-2 shrink-0 border-b border-amber-300 dark:border-amber-500/30">
      <FlaskConical className="h-3.5 w-3.5" />
      TEST MODE — You are viewing test data. No live transactions will be affected.
    </div>
  );
}
