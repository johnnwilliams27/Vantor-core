'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Sparkles } from 'lucide-react';

interface ActivatingPlanModalProps {
  status: 'syncing' | 'done' | 'error';
}

export function ActivatingPlanModal({ status }: ActivatingPlanModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-[background-color,backdrop-filter] duration-400 ${
        mounted ? 'bg-black/40 backdrop-blur-[3px]' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transition-[opacity,transform] duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-6'
        }`}
      >
        <div className="bg-primary px-6 py-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer_8s_ease-in-out_infinite]" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {status === 'done' ? 'Plan Activated' : 'Activating Your Plan'}
              </h2>
              <p className="text-xs text-white/60">
                {status === 'done' ? 'Ready to go' : 'This will only take a moment'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6">
          {status === 'syncing' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm text-foreground font-medium">Setting up your new plan...</p>
                <p className="text-xs text-muted-foreground mt-1">Syncing subscription and configuring your account</p>
              </div>
            </div>
          )}

          {status === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4" style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <div className="text-center">
                <p className="text-sm text-foreground font-medium">Your new plan is now active!</p>
                <p className="text-xs text-muted-foreground mt-1">Redirecting to billing...</p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4" style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
              <div className="text-center">
                <p className="text-sm text-foreground font-medium">Something went wrong</p>
                <p className="text-xs text-muted-foreground mt-1">Please refresh the page to check your plan status</p>
              </div>
              <button
                onClick={() => window.location.href = '/settings/billing'}
                className="px-5 py-2 rounded-lg bg-primary hover:bg-[#134849] text-white text-sm font-medium transition-colors"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
