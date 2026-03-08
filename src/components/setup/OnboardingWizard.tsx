'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle, Wallet, Settings2, LayoutDashboard, LogOut } from 'lucide-react';


const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Vantor',
    description: 'Manage your stablecoin treasury operations across Ethereum and Solana.',
    icon: LayoutDashboard,
  },
  {
    id: 'wallets',
    title: 'Connect Wallets',
    description: 'Link your Ethereum and Solana wallets. You can add more later in the Wallets section.',
    icon: Wallet,
  },
  {
    id: 'erp',
    title: 'ERP Integration (Optional)',
    description: 'Connect SAP or Oracle to sync invoices and vendors automatically.',
    icon: Settings2,
  },
  {
    id: 'invoices',
    title: "You're all set!",
    description: 'Head to the dashboard to monitor balances, manage invoices, and send payments.',
    icon: CheckCircle,
  },
];

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [completing, setCompleting] = useState(false);
  const router = useRouter();
  const { data: session, update } = useSession();

  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await fetch('/api/user/complete-onboarding', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to complete onboarding');

      // Refresh the JWT so the middleware sees onboarding_done: true immediately,
      // without relying on the short-lived bridge cookie.
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-4">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-[#207679]' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#207679]/5">
              <Icon className="h-5 w-5 text-[#207679]" />
            </div>
            <div>
              <CardTitle>{current.title}</CardTitle>
              <div className="text-xs text-gray-400 mt-0.5">
                Step {step + 1} of {STEPS.length}
              </div>
            </div>
          </div>
          <CardDescription className="mt-2">{current.description}</CardDescription>
        </CardHeader>

        <CardContent>
          {step === 1 && (
            <div className="space-y-3 mb-4">
              <div className="p-3 rounded-lg border bg-[#207679]/5 text-sm text-[#195a5c]">
                After setup, navigate to <strong>Wallets</strong> to connect MetaMask (Ethereum) or Phantom (Solana). Each wallet requires a one-time signature verification.
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3 mb-4">
              <div className="p-3 rounded-lg border bg-[#207679]/5 text-sm text-[#195a5c]">
                Navigate to <strong>ERP Settings</strong> to configure SAP or Oracle. Use mock mode (default) to explore the platform without real credentials.
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-2 mb-4">
              {['Live balance monitoring', 'Invoice sync from ERP', 'Immediate & scheduled payments', 'Token swaps via Jupiter & 1inch', 'Immutable audit trail'].map((feature) => (
                <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  {feature}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            <Button onClick={handleNext} disabled={completing}>
              {isLast ? (completing ? 'Setting up…' : 'Go to Dashboard') : 'Next'}
            </Button>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100 flex justify-center">
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
