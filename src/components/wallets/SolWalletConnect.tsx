'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle } from 'lucide-react';

export function SolWalletConnect() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  const handleLink = async () => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setLinking(true);
    try {
      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: 'solana', address: trimmed, label: label.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to link wallet');
      setLinked(true);
      setAddress('');
      setLabel('');

      // Trigger an immediate balance refresh so the newly-linked wallet
      // isn't stuck showing "—" in the UI. Fire-and-forget.
      fetch('/api/balances/refresh', { method: 'POST' })
        .catch((err) => console.warn('[SolWalletConnect] balance refresh failed', err))
        .finally(() => {
          queryClient.invalidateQueries({ queryKey: ['wallets'] });
          queryClient.invalidateQueries({ queryKey: ['treasury-overview'] });
          queryClient.invalidateQueries({ queryKey: ['balances'] });
        });

      toast({ title: 'Wallet linked', description: 'Solana wallet added successfully', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  if (linked) {
    return (
      <div className="flex items-center gap-2 text-green-600 text-sm">
        <CheckCircle className="h-4 w-4" />
        Wallet linked successfully
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="sol-address">Solana address</Label>
        <Input
          id="sol-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sol-label">Nickname (optional)</Label>
        <Input
          id="sol-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Solana Treasury"
        />
      </div>
      <Button onClick={handleLink} disabled={linking || !address.trim()} size="sm">
        {linking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking…</> : 'Link Wallet'}
      </Button>
    </div>
  );
}
