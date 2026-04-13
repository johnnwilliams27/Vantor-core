'use client';
import { useState } from 'react';
import { useSanctionsScreenings, useScreenAddress } from '@/hooks/useCompliance';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { capitalize } from '@/lib/utils';
import { Search, ShieldCheck, ShieldAlert, AlertTriangle } from 'lucide-react';
import { TableRowsSkeleton } from '@/components/ui/operations-skeletons';

// Migrated to semantic Badge variants (style guide Stage 3d).
const RESULT_BADGE: Record<string, { label: string; variant: string; icon: React.ComponentType<{ className?: string }> }> = {
  clear: { label: 'Clear', variant: 'active', icon: ShieldCheck },
  sanctioned: { label: 'Sanctioned', variant: 'failed', icon: ShieldAlert },
  partial_match: { label: 'Partial Match', variant: 'pending', icon: AlertTriangle },
  error: { label: 'Error', variant: 'inactive', icon: AlertTriangle },
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
          <Select
            value={chain}
            onChange={(e) => setChain(e.target.value as 'ethereum' | 'solana')}
            className="w-36"
          >
            <option value="ethereum">Ethereum</option>
            <option value="solana">Solana</option>
          </Select>
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Chain</th>
                <th className="px-4 py-2 font-medium">Result</th>
                <th className="px-4 py-2 font-medium">Screened</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableRowsSkeleton columns={4} rows={3} />
              ) : !screenings?.length ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                    No screenings yet
                  </td>
                </tr>
              ) : (
                screenings.map((s) => {
                  const badge = RESULT_BADGE[s.result] ?? RESULT_BADGE.error;
                  const Icon = badge.icon;
                  return (
                    <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">
                        {s.address.slice(0, 10)}...{s.address.slice(-6)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={s.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                          {capitalize(s.chain)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={badge.variant as any} icon={<Icon />}>
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(s.screened_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
