'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export function PastDueBanner() {
  const { data: session } = useSession();
  const { data: sub } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
    enabled: !!session?.user?.enterprise_id,
  });

  if (sub?.status !== 'past_due') return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-500">
          Payment failed. Update your payment method to avoid service interruption.
        </span>
      </div>
      <Link
        href="/settings/billing?tab=payment"
        className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
      >
        Update Payment
      </Link>
    </div>
  );
}
