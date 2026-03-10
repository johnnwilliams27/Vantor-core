'use client';
import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { EthWalletConnect } from '@/components/wallets/EthWalletConnect';
import { SolWalletConnect } from '@/components/wallets/SolWalletConnect';
import { useWallets, useUnlinkWallet } from '@/hooks/useWallets';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { truncateAddress, formatDate } from '@/lib/utils';
import { Trash2, CheckCircle, Clock } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import '@solana/wallet-adapter-react-ui/styles.css';

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function CryptoWalletsTab() {
  const { data: wallets, isLoading } = useWallets();
  const { mutateAsync: unlinkWallet, isPending } = useUnlinkWallet();
  const { data: overview } = useTreasuryOverview();
  const { toast } = useToast();

  const handleUnlink = async (id: string) => {
    try {
      await unlinkWallet(id);
      toast({ title: 'Wallet unlinked', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Link Ethereum Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <EthWalletConnect />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Link Solana Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <SolWalletConnect />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Linked Wallets</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : wallets?.length ? (
            <div className="space-y-3">
              {wallets.map((wallet) => {
                const positions = overview?.cryptoPositions.filter((p) => p.walletId === wallet.id) ?? [];
                const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);
                return (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant={wallet.chain === 'ethereum' ? 'info' : 'secondary'}>
                        {wallet.chain === 'ethereum' ? 'Ethereum' : 'Solana'}
                      </Badge>
                      <div className="min-w-0">
                        <div className="font-mono text-sm">
                          {truncateAddress(wallet.address, 8)}
                        </div>
                        {wallet.label && (
                          <div className="text-xs text-muted-foreground">{wallet.label}</div>
                        )}
                      </div>
                      {wallet.verified_at ? (
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {positions.length > 0 && (
                        <div className="text-right">
                          <div className="text-sm font-semibold tabular-nums">{formatUsd(totalUsd)}</div>
                          <div className="text-xs text-muted-foreground">
                            {positions.map((p) => `${p.token} ${Number(p.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ')}
                          </div>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleUnlink(wallet.id)}
                        disabled={isPending}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">
              No wallets linked yet. Connect one above.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WalletsPage() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppShell title="Wallets">
            <CryptoWalletsTab />
          </AppShell>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
