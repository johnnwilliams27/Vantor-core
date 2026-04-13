'use client';
import { ChainSwapForm } from '@/components/swaps/ChainSwapForm';
import { BridgeHistory } from '@/components/bridges/BridgeHistory';
import { ScheduleBridgeForm } from '@/components/scheduled/ScheduleBridgeForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ComingSoonPanel } from '@/components/ui/coming-soon-panel';
import { Shuffle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useSession } from 'next-auth/react';

export default function BridgesPage() {
  const testMode = useAppStore((s) => s.testMode);
  const { data: session } = useSession();
  const tier = session?.user?.subscription_tier ?? 'lite';
  const showComingSoon = !(tier === 'lite' && testMode);

  if (showComingSoon) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shuffle className="h-5 w-5" />
              Cross-chain Bridges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ComingSoonPanel
              description="Cross-chain bridging (Ethereum ↔ Solana) is being rewired through a dedicated bridging provider (CCTP / LayerZero / Wormhole) to give you real on-chain execution with verifiable settlement. We'll open this back up once the integration is complete."
              secondary="In the meantime, you can still view historical bridge records in reporting exports, and use on-chain transfers from your wallets for same-chain movement."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <h1 className="text-xl font-semibold text-white">Bridges</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChainSwapForm />
        <ScheduleBridgeForm />
      </div>
      <BridgeHistory />
    </div>
  );
}
