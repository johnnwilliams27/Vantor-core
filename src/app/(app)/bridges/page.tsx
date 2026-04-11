'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Shuffle } from 'lucide-react';

export default function BridgesPage() {
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
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-base font-semibold mb-2">Coming soon</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              Cross-chain bridging (Ethereum ↔ Solana) is being rewired
              through a dedicated bridging provider (CCTP / LayerZero /
              Wormhole) to give you real on-chain execution with verifiable
              settlement. We&apos;ll open this back up once the integration
              is complete.
            </p>
            <p className="text-xs text-muted-foreground mt-4 max-w-md mx-auto">
              In the meantime, you can still view historical bridge records
              in reporting exports, and use on-chain transfers from your
              wallets for same-chain movement.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
