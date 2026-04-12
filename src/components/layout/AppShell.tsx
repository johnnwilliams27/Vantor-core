'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PageSpinner } from '@/components/ui/spinner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TestModeBanner } from './TestModeBanner';
import { NavigationProgress } from './NavigationProgress';
import { AgentPanel } from '@/components/agent/AgentPanel';
import { OnboardingWizard } from '@/components/setup/OnboardingWizard';
import { useTestMode } from '@/hooks/useTestMode';
import { isPaidTier, TierSlug } from '@/lib/billing/tiers';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { PaymentFailedGate } from '@/components/billing/PaymentFailedGate';
import { Shield } from 'lucide-react';

function KycRequiredModal() {
  const { update: updateSession } = useSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  const handleComplete = async () => {
    await updateSession();
    window.location.reload();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kyc-modal-title"
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-[background,backdrop-filter] duration-400 ${
        mounted ? 'bg-black/40 backdrop-blur-[3px]' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-[opacity,transform] duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-6'
        }`}
      >
        {/* Header */}
        <div className="bg-primary px-6 py-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer_8s_ease-in-out_infinite]" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 id="kyc-modal-title" className="text-base font-semibold text-white">Personal Identity Verification</h2>
              <p className="text-xs text-white/60">Required for paid plan access</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-muted-foreground mb-5">
            Your organization has upgraded to a paid plan. Please complete personal identity verification (KYC) to continue accessing the platform.
          </p>
          <PersonaKycFlow onComplete={handleComplete} />
        </div>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const { testMode, toggleTestMode } = useTestMode();

  // Auto-enable test mode for Lite users (they can only use test mode)
  const [switchingTestMode, setSwitchingTestMode] = useState(false);
  useEffect(() => {
    if (!session?.user || switchingTestMode) return;
    const tier = session.user.subscription_tier as TierSlug;
    if (!isPaidTier(tier) && testMode === false) {
      setSwitchingTestMode(true);
      toggleTestMode(true).then(() => {
        window.location.reload();
      });
    }
  }, [session?.user?.subscription_tier, testMode, toggleTestMode, switchingTestMode]);

  // Redirect away from old /kyc-required page
  useEffect(() => {
    if (pathname === '/kyc-required') {
      router.replace('/dashboard');
    }
  }, [pathname, router]);

  if (status === 'loading' || switchingTestMode) {
    return <PageSpinner />;
  }

  // KYC enforcement only kicks in when Persona is configured in this
  // environment. Without NEXT_PUBLIC_PERSONA_KYC_ENABLED, the Persona SDK
  // can't run and the modal would be a dead end. Matches the same pattern
  // used in UpgradeFlow and /api/billing/checkout.
  const kycConfigured = !!process.env.NEXT_PUBLIC_PERSONA_KYC_ENABLED;
  const needsKyc = kycConfigured &&
    session?.user &&
    isPaidTier(session.user.subscription_tier as TierSlug) &&
    session.user.kyc_status !== 'completed' &&
    !session.user.is_app_admin;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-teal-500 focus:text-white focus:font-semibold focus:text-sm"
      >
        Skip to content
      </a>
      <NavigationProgress />
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <TestModeBanner />
        <Topbar />
        <main id="main-content" className="flex-1 overflow-auto p-4 sm:p-8">
          <div key={pathname} className="fade-in motion-reduce:animate-none">{children}</div>
        </main>
      </div>
      <AgentPanel />
      {session?.user && !session.user.onboarding_done && !session.user.is_app_admin && (
        <OnboardingWizard />
      )}
      {needsKyc && <KycRequiredModal />}
      <PaymentFailedGate />
    </div>
  );
}
