'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { PersonaKybFlow } from '@/components/kyc/PersonaKybFlow';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { TierSlug, TIERS } from '@/lib/billing/tiers';
import { Shield, CreditCard, CheckCircle2, ArrowRight, Sparkles, AlertTriangle } from 'lucide-react';
import { SandboxWarningStep } from './SandboxWarningStep';
import { Spinner } from '@/components/ui/spinner';

type UpgradeStep = 'kyb' | 'kyc' | 'sandbox_warning' | 'checkout';

interface UpgradeFlowProps {
  targetTier: TierSlug;
  onCancel: () => void;
}

const STEP_ICONS: Record<UpgradeStep, typeof Shield> = {
  kyb: Shield,
  kyc: Shield,
  sandbox_warning: AlertTriangle,
  checkout: CreditCard,
};

const STEP_TITLES: Record<UpgradeStep, string> = {
  kyb: 'Business Verification',
  kyc: 'Identity Verification',
  sandbox_warning: 'Sandbox Notice',
  checkout: 'Payment',
};

export function UpgradeFlow({ targetTier, onCancel }: UpgradeFlowProps) {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // KYB requires a Persona template — skip if not configured or already completed
  // PERSONA_KYB_TEMPLATE_ID is set server-side; expose via a public flag
  const kybConfigured = !!process.env.NEXT_PUBLIC_PERSONA_KYB_ENABLED;
  const kybDone = session?.user?.kyb_status === 'completed';
  const kycDone = session?.user?.kyc_status === 'completed';
  const skipKyb = !kybConfigured || kybDone;
  const isLite = session?.user?.subscription_tier === 'lite' || !session?.user?.subscription_tier;

  // Compute initial step ONCE
  // Sandbox warning only shows when upgrading from Lite (first paid upgrade)
  const initialStepRef = useRef<UpgradeStep>(
    !skipKyb ? 'kyb' : !kycDone ? 'kyc' : (isLite ? 'sandbox_warning' : 'checkout')
  );
  const [step, setStep] = useState<UpgradeStep>(initialStepRef.current);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Entrance animation
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  const animateToStep = (next: UpgradeStep) => {
    setTransitioning(true);
    setTimeout(() => {
      setStep(next);
      setTransitioning(false);
    }, 250);
  };

  const handleKybComplete = () => animateToStep('kyc');
  const handleKycComplete = () => animateToStep(isLite ? 'sandbox_warning' : 'checkout');
  const handleSandboxAcknowledged = () => animateToStep('checkout');

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    setCheckoutError(null);
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
        setCheckoutError(data.error || 'Checkout failed');
        setCheckoutLoading(false);
      }
    } catch {
      setCheckoutError('Something went wrong. Please try again.');
      setCheckoutLoading(false);
    }
  };

  // Auto-trigger checkout
  useEffect(() => {
    if (step === 'checkout') {
      handleCheckout();
    }
  }, [step]);

  const tierDef = TIERS[targetTier];
  const StepIcon = STEP_ICONS[step];

  const progressSteps = (() => {
    const steps: { key: UpgradeStep; label: string; icon: typeof Shield }[] = [];
    if (!skipKyb) steps.push({ key: 'kyb', label: 'Verify Business', icon: Shield });
    if (!kycDone) steps.push({ key: 'kyc', label: 'Verify Identity', icon: Shield });
    if (isLite) steps.push({ key: 'sandbox_warning', label: 'Sandbox Notice', icon: AlertTriangle });
    steps.push({ key: 'checkout', label: 'Payment', icon: CreditCard });
    return steps;
  })();

  const currentIndex = progressSteps.findIndex(s => s.key === step);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-400 ${
        mounted ? 'bg-black/40 backdrop-blur-[3px]' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden transition-all duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-6'
        }`}
      >
        {/* Teal header */}
        <div className="bg-[#19595b] px-6 pt-5 pb-6 relative overflow-hidden">
          {/* Shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer_8s_ease-in-out_infinite]" />

          <div className="relative">
            {/* Top row */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">Upgrade to {tierDef.name}</h2>
                  <p className="text-[11px] text-white/50">{tierDef.displayPrice}</p>
                </div>
              </div>
              <button
                onClick={onCancel}
                className="text-white/40 hover:text-white/70 text-xs font-medium px-2 py-1 rounded-md hover:bg-white/10 transition-all"
              >
                Cancel
              </button>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-1.5">
              {progressSteps.map((s, i) => {
                const isActive = i === currentIndex;
                const isDone = i < currentIndex;
                const SIcon = s.icon;

                return (
                  <div key={s.key} className="flex-1 flex items-center gap-1.5">
                    <div className="flex-1">
                      <div className="h-1 rounded-full bg-white/15 overflow-hidden mb-2">
                        <div
                          className="h-full rounded-full transition-all duration-700 ease-out"
                          style={{
                            width: isDone ? '100%' : isActive ? '50%' : '0%',
                            background: isDone
                              ? 'rgba(255,255,255,0.9)'
                              : 'linear-gradient(90deg, rgba(255,255,255,0.7), rgba(255,255,255,0.3))',
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isDone ? (
                          <CheckCircle2 className="w-3 h-3 text-white/70 flex-shrink-0" />
                        ) : (
                          <SIcon className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-white' : 'text-white/30'}`} />
                        )}
                        <span className={`text-[10px] font-medium ${isActive ? 'text-white' : isDone ? 'text-white/60' : 'text-white/30'}`}>
                          {s.label}
                        </span>
                      </div>
                    </div>
                    {i < progressSteps.length - 1 && (
                      <ArrowRight className={`w-3 h-3 flex-shrink-0 mt-3 ${isDone ? 'text-white/40' : 'text-white/15'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Content with step transitions */}
        <div className="p-6">
          <div
            className={`transition-all duration-300 ${
              transitioning ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'
            }`}
          >
            {step === 'kyb' && (
              <div style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                <PersonaKybFlow onComplete={handleKybComplete} />
              </div>
            )}
            {step === 'kyc' && (
              <div style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                <PersonaKycFlow onComplete={handleKycComplete} />
              </div>
            )}
            {step === 'sandbox_warning' && (
              <div style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                <SandboxWarningStep onContinue={handleSandboxAcknowledged} />
              </div>
            )}
            {step === 'checkout' && (
              <div className="text-center py-8" style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                {checkoutError ? (
                  <div style={{ animation: 'fadeSlideUp 0.3s ease-out both' }}>
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                      <CreditCard className="w-6 h-6 text-red-400" />
                    </div>
                    <p className="text-red-400 text-sm mb-4">{checkoutError}</p>
                    <button
                      onClick={handleCheckout}
                      className="px-5 py-2.5 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                    <div className="flex justify-center mb-5">
                      <Spinner size="md" />
                    </div>
                    <p className="text-sm text-muted-foreground">Redirecting to Stripe...</p>
                    <p className="text-xs text-muted-foreground/50 mt-1.5">Setting up your {tierDef.name} subscription</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.5); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
