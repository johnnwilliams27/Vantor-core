'use client';
import { useState } from 'react';
import { useSanctionsScreenings, useScreenAddress } from '@/hooks/useCompliance';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Search, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';

const RESULT_BADGE: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  clear: { label: 'Clear', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: ShieldCheck },
  sanctioned: { label: 'Sanctioned', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: ShieldAlert },
  partial_match: { label: 'Partial Match', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: AlertTriangle },
  error: { label: 'Error', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400', icon: AlertTriangle },
};

export function SanctionsScreeningPanel() {
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState<'ethereum' | 'solana'>('ethereum');
  const { data: screenings, isLoading } = useSanctionsScreenings();
  const screenAddress = useScreenAddress();
  const { toast } = useToast();

  const handleScreen = async () => {
    if (!address.trim()) return;
    try {
      const result = await screenAddress.mutateAsync({ address: address.trim(), chain });
      toast({
        title: `Screening: ${result.result.toUpperCase()}`,
        description: result.result === 'sanctioned'
          ? 'This address is on a sanctions list!'
          : 'Address passed screening.',
        variant: result.result === 'sanctioned' ? 'destructive' : 'success',
      });
    } catch (err) {
      toast({ title: 'Screening failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Manual screening form */}
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-3">Screen Address</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter wallet address..."
            className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          />
          <select
            value={chain}
            onChange={(e) => setChain(e.target.value as 'ethereum' | 'solana')}
            className="rounded-md border bg-background px-3 py-2 text-sm w-32"
          >
            <option value="ethereum">Ethereum</option>
            <option value="solana">Solana</option>
          </select>
          <Button
            onClick={handleScreen}
            disabled={!address.trim() || screenAddress.isPending}
            size="sm"
            className="flex items-center gap-1.5"
          >
            <Search className="h-3.5 w-3.5" />
            {screenAddress.isPending ? 'Screening...' : 'Screen'}
          </Button>
        </div>
      </div>

      {/* Recent screenings */}
      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b">
          <h3 className="text-sm font-semibold">Recent Screenings</h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : !screenings?.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No screenings yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Address</th>
                  <th className="px-4 py-2 font-medium">Chain</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                  <th className="px-4 py-2 font-medium">Risk Score</th>
                  <th className="px-4 py-2 font-medium">Screened</th>
                </tr>
              </thead>
              <tbody>
                {screenings.map((s) => {
                  const badge = RESULT_BADGE[s.result] ?? RESULT_BADGE.error;
                  const Icon = badge.icon;
                  return (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">
                        {s.address.slice(0, 10)}...{s.address.slice(-6)}
                      </td>
                      <td className="px-4 py-2 capitalize">{s.chain}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                          <Icon className="h-3 w-3" />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2">{s.risk_score ?? '-'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(s.screened_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
