import { ChainSwapForm } from '@/components/swaps/ChainSwapForm';
import { BridgeHistory } from '@/components/bridges/BridgeHistory';

export const metadata = { title: 'Bridges – Vantor' };

export default function BridgesPage() {
  return (
    <div className="space-y-6">
      <ChainSwapForm />
      <BridgeHistory />
    </div>
  );
}
