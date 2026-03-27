'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import {
  CheckCircle,
  Wallet,
  Settings2,
  LayoutDashboard,
  LogOut,
  TrendingUp,
  Shield,
  BarChart3,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Vantor',
    description: 'Your treasury management platform is ready. Let\'s get started:',
    icon: LayoutDashboard,
  },
  {
    id: 'wallets',
    title: 'Connect Wallets & Bank Accounts',
    description: 'Link your Ethereum or Solana wallets and bank accounts.',
    icon: Wallet,
  },
  {
    id: 'erp',
    title: 'ERP Integration',
    description: 'Connect your ERP system to sync invoices and vendors automatically.',
    icon: Settings2,
  },
  {
    id: 'ready',
    title: "You're all set!",
    description: 'Your workspace is configured. Head to the dashboard to get started.',
    icon: CheckCircle,
  },
];

const WELCOME_FEATURES = [
  { icon: Wallet, label: 'Multi-chain wallet management' },
  { icon: TrendingUp, label: 'Yield optimization strategies' },
  { icon: Shield, label: 'Compliance & sanctions screening' },
  { icon: BarChart3, label: 'Cash flow forecasting & reporting' },
  { icon: Settings2, label: 'ERP & bank account integrations' },
];

const READY_FEATURES = [
  'Live balance monitoring across all accounts',
  'Invoice sync from connected ERP systems',
  'On/off ramps, swaps & cross-chain bridges',
  'AI-powered treasury recommendations',
  'Immutable audit trail for all operations',
];

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const router = useRouter();
  const { update } = useSession();

  useEffect(() => {
    // Entrance animation
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const isLast = step === STEPS.length - 1;

  const animateStep = useCallback((newStep: number, dir: 'forward' | 'back') => {
    setDirection(dir);
    setTransitioning(true);
    setTimeout(() => {
      setStep(newStep);
      setTransitioning(false);
    }, 200);
  }, []);

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      animateStep(step + 1, 'forward');
    }
  };

  const handleBack = () => {
    if (step > 0) {
      animateStep(step - 1, 'back');
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await fetch('/api/user/complete-onboarding', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to complete onboarding');
      await update();
      router.push('/dashboard');
    } catch (err) {
      console.error('Failed to complete onboarding', err);
      setCompleting(false);
    }
  };

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-500 ${
        mounted ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden transition-all duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'
        }`}
      >
        {/* Teal header with subtle shimmer */}
        <div className="bg-[#19595b] px-6 py-5 relative overflow-hidden">
          {/* Animated gradient accent */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent animate-[shimmer_8s_ease-in-out_infinite]" />

          <div className="relative">
            {/* Progress bar */}
            <div className="flex items-center gap-2 mb-3">
              {STEPS.map((s, i) => (
                <div
                  key={s.id}
                  className="h-1.5 flex-1 rounded-full bg-white/20 overflow-hidden"
                >
                  <div
                    className="h-full rounded-full bg-white transition-all duration-500 ease-out"
                    style={{ width: i <= step ? '100%' : '0%' }}
                  />
                </div>
              ))}
            </div>

            {/* Icon + title with transition */}
            <div
              className={`flex items-center gap-3 transition-all duration-300 ${
                transitioning ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'
              }`}
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/10 transition-transform duration-300 hover:scale-105">
                <Icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{current.title}</h2>
                <p className="text-xs text-white/60">Step {step + 1} of {STEPS.length}</p>
              </div>
            </div>
            <p
              className={`mt-3 text-sm text-white/80 leading-relaxed transition-all duration-300 delay-75 ${
                transitioning ? 'opacity-0 translate-x-2' : 'opacity-100 translate-x-0'
              }`}
            >
              {current.description}
            </p>
          </div>
        </div>

        {/* Content with step transitions */}
        <div className="px-6 py-5">
          <div
            className={`transition-all duration-300 ${
              transitioning
                ? direction === 'forward'
                  ? 'opacity-0 -translate-x-4'
                  : 'opacity-0 translate-x-4'
                : 'opacity-100 translate-x-0'
            }`}
          >
            {/* Welcome — feature list */}
            {step === 0 && (
              <div className="space-y-2">
                {WELCOME_FEATURES.map(({ icon: FIcon, label }, i) => (
                  <div
                    key={label}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/50 hover:bg-muted transition-colors duration-200"
                    style={{
                      animation: !transitioning ? `fadeSlideIn 0.4s ease-out ${i * 60}ms both` : undefined,
                    }}
                  >
                    <div className="w-8 h-8 rounded-md bg-[#19595b]/10 flex items-center justify-center flex-shrink-0">
                      <FIcon className="h-4 w-4 text-[#19595b]" />
                    </div>
                    <span className="text-sm text-foreground">{label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Wallets */}
            {step === 1 && (
              <div className="space-y-3">
                <div
                  className="p-4 rounded-lg border border-border bg-muted/30"
                  style={{ animation: 'fadeSlideIn 0.4s ease-out both' }}
                >
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Navigate to <strong className="text-foreground">Wallets</strong> to connect your Ethereum wallet (MetaMask, Coinbase, etc.) or Solana wallet (Phantom, Solflare, Ledger), and <strong className="text-foreground">Bank Accounts</strong> to link your bank accounts via Plaid.
                  </p>
                </div>
                <div
                  className="p-4 rounded-lg border border-[#19595b]/20 bg-[#19595b]/5"
                  style={{ animation: 'fadeSlideIn 0.4s ease-out 100ms both' }}
                >
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Test mode is active</strong> — your account comes with pre-loaded test wallets and bank accounts so you can explore the platform right away.
                  </p>
                </div>
              </div>
            )}

            {/* ERP */}
            {step === 2 && (
              <div className="space-y-3">
                <div
                  className="p-4 rounded-lg border border-border bg-muted/30"
                  style={{ animation: 'fadeSlideIn 0.4s ease-out both' }}
                >
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Navigate to <strong className="text-foreground">ERP Systems</strong> in Settings to configure SAP, Oracle, Xero, or NetSuite.
                  </p>
                </div>
                <div
                  className="p-4 rounded-lg border border-[#19595b]/20 bg-[#19595b]/5"
                  style={{ animation: 'fadeSlideIn 0.4s ease-out 100ms both' }}
                >
                  <p className="text-xs text-muted-foreground">
                    <strong className="text-foreground">Optional</strong> — test ERP integrations are already configured. You can skip this and connect your real ERP later.
                  </p>
                </div>
              </div>
            )}

            {/* Ready — with celebratory feel */}
            {step === 3 && (
              <div>
                <div
                  className="flex justify-center mb-4"
                  style={{ animation: 'popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) both' }}
                >
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Sparkles className="h-7 w-7 text-emerald-500" />
                  </div>
                </div>
                <div className="space-y-2">
                  {READY_FEATURES.map((feature, i) => (
                    <div
                      key={feature}
                      className="flex items-center gap-2.5 py-1"
                      style={{ animation: `fadeSlideIn 0.4s ease-out ${i * 60 + 150}ms both` }}
                    >
                      <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={step === 0 || transitioning}
              className="transition-opacity duration-200"
            >
              Back
            </Button>
            <Button
              size="sm"
              onClick={handleNext}
              disabled={completing || transitioning}
              className="bg-[#19595b] hover:bg-[#134849] text-white gap-1.5 transition-all duration-200 hover:shadow-[0_0_20px_rgba(25,89,91,0.3)]"
            >
              {isLast ? (completing ? 'Setting up...' : 'Go to Dashboard') : 'Continue'}
              {!isLast && <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />}
            </Button>
          </div>

          <div className="mt-4 flex justify-center">
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes popIn {
          from {
            opacity: 0;
            transform: scale(0.5);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes shimmer {
          0%, 100% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  );
}
