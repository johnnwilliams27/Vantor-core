'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useTestMode } from '@/hooks/useTestMode';
import { useToast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

export function TestModeToggle() {
  const { data: session } = useSession();
  const { testMode, toggleTestMode } = useTestMode();
  const { toast } = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const tier = session?.user?.subscription_tier;

  // Lite tier: always in test mode, cannot switch to live
  if (tier === 'lite') {
    return (
      <div className="relative group">
        <button
          disabled
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all border opacity-50 cursor-not-allowed',
            'bg-amber-500/8 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
          )}
        >
          <FlaskConical className="h-3.5 w-3.5" />
          <span>Test</span>
          <div className="relative w-7 h-4 rounded-full transition-colors bg-amber-500">
            <div className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform translate-x-3.5" />
          </div>
        </button>
        <div className="absolute hidden group-hover:block top-full mt-1 right-0 bg-popover border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground shadow-lg whitespace-nowrap z-50">
          Upgrade to a paid plan to access live mode
        </div>
      </div>
    );
  }

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
            ? 'bg-amber-500/8 text-amber-700 border-amber-200 hover:bg-amber-500/15 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
            : 'bg-green-500/8 text-green-700 border-green-200 hover:bg-green-500/15 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20'
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
