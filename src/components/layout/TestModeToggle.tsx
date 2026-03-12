'use client';
import { useState } from 'react';
import { useTestMode } from '@/hooks/useTestMode';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TestModeToggle() {
  const { testMode, toggleTestMode } = useTestMode();
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleToggleClick = () => {
    setShowConfirm(true);
  };

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await toggleTestMode(!testMode);
      toast({
        title: testMode ? 'Switched to Live Mode' : 'Switched to Test Mode',
        description: testMode
          ? 'You are now viewing live data.'
          : 'You are now viewing test data. No live transactions will be affected.',
        variant: testMode ? 'success' : 'default',
      });
      setShowConfirm(false);
    } catch (err) {
      toast({
        title: 'Failed to switch mode',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <button
        onClick={handleToggleClick}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border',
          testMode
            ? 'bg-amber-500/10 text-amber-700 border-amber-300 hover:bg-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30'
            : 'bg-green-500/10 text-green-700 border-green-300 hover:bg-green-500/20 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30'
        )}
        title={testMode ? 'Currently in Test Mode — click to switch' : 'Currently Live — click to switch to Test Mode'}
      >
        <FlaskConical className="h-3.5 w-3.5" />
        <span>{testMode ? 'Test' : 'Live'}</span>
        <div
          className={cn(
            'relative w-7 h-4 rounded-full transition-colors',
            testMode ? 'bg-amber-500' : 'bg-green-500'
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
              testMode ? 'translate-x-3.5' : 'translate-x-0.5'
            )}
          />
        </div>
      </button>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        title={testMode ? 'Switch to Live Mode' : 'Switch to Test Mode'}
        description={
          testMode
            ? 'You will return to your live data. Any actions taken in test mode did not affect your live data.'
            : 'Test Mode loads a separate set of demo data. Your live data will not be affected. All modules will use test data, while yield product information and market data will remain live.'
        }
        confirmLabel={testMode ? 'Go Live' : 'Enter Test Mode'}
        variant="default"
        isPending={isPending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
