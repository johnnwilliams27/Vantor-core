'use client';

import { useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface UpgradeGateProps {
  children: ReactNode;
  feature?: string;
}

/**
 * Wraps an action button. For Lite tier users, replaces the action with
 * a lock icon + upgrade modal trigger. For paid tiers, renders children as-is.
 */
export function UpgradeGate({ children, feature }: UpgradeGateProps) {
  const { data: session } = useSession();
  const tier = session?.user?.subscription_tier ?? 'lite';
  const [showModal, setShowModal] = useState(false);

  if (tier !== 'lite') return <>{children}</>;

  return (
    <>
      <Button
        variant="secondary"
        className="w-full relative opacity-80"
        onClick={() => setShowModal(true)}
      >
        <Lock className="mr-2 h-3.5 w-3.5" />
        {feature || 'Upgrade to Unlock'}
        <span className="ml-2 text-[10px] font-semibold bg-teal-600/20 text-teal-400 px-1.5 py-0.5 rounded-full">
          PRO
        </span>
      </Button>

      {showModal && (
        <UpgradeModal
          feature={feature}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function UpgradeModal({ feature, onClose }: { feature?: string; onClose: () => void }) {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0a1628] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-teal-600/20 flex items-center justify-center">
            <Lock className="h-5 w-5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold">Upgrade to Unlock</h3>
            {feature && (
              <p className="text-sm text-gray-400">{feature}</p>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-6">
          Paid plans include live bank connections, wallet linking, DeFi yield deposits,
          ramps, swaps, transfers, payments, and ERP integrations.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Maybe Later
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              router.push('/settings/billing');
            }}
          >
            View Plans
          </Button>
        </div>
      </div>
    </div>
  );
}
