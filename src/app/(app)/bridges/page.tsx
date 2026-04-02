'use client';
import { ChainSwapForm } from '@/components/swaps/ChainSwapForm';
import { BridgeHistory } from '@/components/bridges/BridgeHistory';
import { ScheduleBridgeForm } from '@/components/scheduled/ScheduleBridgeForm';

export default function BridgesPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChainSwapForm />
        <ScheduleBridgeForm />
      </div>
      <BridgeHistory />
    </div>
  );
}
