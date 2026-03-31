'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface SandboxWarningStepProps {
  onContinue: () => void;
}

export function SandboxWarningStep({ onContinue }: SandboxWarningStepProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="py-4" style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Your test environment will change
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you upgrade, your test mode demo data will be cleared and replaced
            with a clean developer sandbox. You&apos;ll connect your own sandbox wallets,
            bank accounts, and integrations for testing.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer mb-5 group">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary/30 cursor-pointer"
        />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          I understand my demo data will be removed
        </span>
      </label>

      <button
        onClick={onContinue}
        disabled={!acknowledged}
        className="w-full px-5 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#19595b] hover:bg-[#134849] text-white"
      >
        Continue to Payment
      </button>
    </div>
  );
}
