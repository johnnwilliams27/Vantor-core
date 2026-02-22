'use client';
import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle } from 'lucide-react';

export function EthWalletConnect() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [linking, setLinking] = useState(false);
  const [linked, setLinked] = useState(false);

  const handleLink = async () => {
    if (!address) return;
    setLinking(true);
    try {
      const message = `Link Ethereum wallet to Vantor\nAddress: ${address}\nTimestamp: ${Date.now()}`;
      const signature = await signMessageAsync({ message });

      const res = await fetch('/api/auth/wallet-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: 'ethereum', address, message, signature, label }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error);
      }

      setLinked(true);
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      toast({ title: 'Wallet linked', description: `${address.slice(0, 8)}… linked successfully`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-4">
      <ConnectButton />

      {isConnected && address && !linked && (
        <div className="space-y-3 p-4 rounded-lg border bg-gray-50">
          <div className="text-sm font-medium">Link this wallet to your account</div>
          <div className="space-y-2">
            <Label htmlFor="eth-label">Wallet label (optional)</Label>
            <Input
              id="eth-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Main Treasury ETH"
            />
          </div>
          <Button onClick={handleLink} disabled={linking} size="sm">
            {linking ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Linking…</>
            ) : (
              'Link Wallet'
            )}
          </Button>
        </div>
      )}

      {linked && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle className="h-4 w-4" />
          Wallet linked successfully
        </div>
      )}
    </div>
  );
}
