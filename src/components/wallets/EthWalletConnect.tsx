'use client';
import { useState } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, X } from 'lucide-react';

export function EthWalletConnect() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
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

      // Trigger an immediate balance refresh so the newly-linked wallet
      // isn't stuck showing "—" in the UI. Fire-and-forget — if it fails
      // the nightly cron will pick it up, and the user can always refresh
      // manually.
      fetch('/api/balances/refresh', { method: 'POST' })
        .catch((err) => console.warn('[EthWalletConnect] balance refresh failed', err))
        .finally(() => {
          queryClient.invalidateQueries({ queryKey: ['wallets'] });
          queryClient.invalidateQueries({ queryKey: ['treasury-overview'] });
          queryClient.invalidateQueries({ queryKey: ['balances'] });
        });

      toast({ title: 'Wallet linked', description: `${address.slice(0, 8)}… linked successfully`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-4">
      {!isConnected && !linked && (
        <ConnectButton.Custom>
          {({ openConnectModal, mounted }) => {
            if (!mounted) return null;
            return (
              <Button size="sm" onClick={openConnectModal}>
                Link Wallet
              </Button>
            );
          }}
        </ConnectButton.Custom>
      )}

      {isConnected && address && !linked && (
        <div className="space-y-3 p-4 rounded-lg border bg-muted/40">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Link this wallet to your account</div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => disconnect()}
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
          <div className="text-xs font-mono text-muted-foreground">{address}</div>
          <div className="space-y-2">
            <Label htmlFor="eth-label">Wallet nickname (optional)</Label>
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle className="h-4 w-4" />
            Wallet linked successfully
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setLinked(false); setLabel(''); disconnect(); }}
          >
            Link Another
          </Button>
        </div>
      )}
    </div>
  );
}
