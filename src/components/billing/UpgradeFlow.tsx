'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PersonaKybFlow } from '@/components/kyc/PersonaKybFlow';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { TierSlug, TIERS } from '@/lib/billing/tiers';

type UpgradeStep = 'kyb' | 'kyc' | 'checkout' | 'complete';

interface UpgradeFlowProps {
  targetTier: TierSlug;
  onCancel: () => void;
}

export function UpgradeFlow({ targetTier, onCancel }: UpgradeFlowProps) {
  const { data: session } = useSession();
  const router = useRouter();

  // Determine starting step based on current verification status
  const kybDone = session?.user?.kyb_status === 'completed';
  const kycDone = session?.user?.kyc_status === 'completed';

  const initialStep: UpgradeStep = !kybDone ? 'kyb' : !kycDone ? 'kyc' : 'checkout';
  const [step, setStep] = useState<UpgradeStep>(initialStep);
  const [loading, setLoading] = useState(false);

  const handleKybComplete = () => setStep('kyc');
  const handleKycComplete = () => setStep('checkout');

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTier }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout failed');
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  // Auto-trigger checkout if KYB+KYC already done
  useEffect(() => {
    if (step === 'checkout' && !loading) {
      handleCheckout();
    }
  }, [step, loading]);

  const tierDef = TIERS[targetTier];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Upgrade to {tierDef.name}</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground text-sm">
            Cancel
          </button>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mb-6">
          {['Business Verification', 'Identity Verification', 'Payment'].map((label, i) => {
            const steps: UpgradeStep[] = ['kyb', 'kyc', 'checkout'];
            const stepIndex = steps.indexOf(step);
            const isActive = i === stepIndex;
            const isDone = i < stepIndex || (i === 0 && kybDone) || (i === 1 && kycDone);

            return (
              <div key={label} className="flex-1">
                <div
                  className={`h-1 rounded-full mb-1 ${
                    isDone ? 'bg-primary' : isActive ? 'bg-primary/50' : 'bg-muted'
                  }`}
                />
                <p
                  className={`text-xs ${
                    isActive ? 'text-primary font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </p>
              </div>
            );
          })}
        </div>

        {step === 'kyb' && (
          <PersonaKybFlow onComplete={handleKybComplete} />
        )}
        {step === 'kyc' && (
          <PersonaKycFlow onComplete={handleKycComplete} />
        )}
        {step === 'checkout' && (
          <div className="text-center py-8 text-muted-foreground">
            Redirecting to payment...
          </div>
        )}
      </div>
    </div>
  );
}
