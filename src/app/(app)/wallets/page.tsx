'use client';
import { useState, useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { EthWalletConnect } from '@/components/wallets/EthWalletConnect';
import { SolWalletConnect } from '@/components/wallets/SolWalletConnect';
import { BankAccountsTab } from '@/components/banking/BankAccountsTab';
import { useWallets, useUnlinkWallet } from '@/hooks/useWallets';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { truncateAddress, formatDate } from '@/lib/utils';
import { Trash2, CheckCircle, Clock, Wallet, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import '@solana/wallet-adapter-react-ui/styles.css';

type Tab = 'crypto' | 'bank';

function CryptoWalletsTab() {
  const { data: wallets, isLoading } = useWallets();
  const { mutateAsync: unlinkWallet, isPending } = useUnlinkWallet();
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
    <div className="space-y-6 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ethereum Wallet</CardTitle>
          </CardHeader>
          <CardContent>
            <EthWalletConnect />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Solana Wallet</CardTitle>
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
            <div className="text-sm text-gray-400">Loading…</div>
          ) : wallets?.length ? (
            <div className="space-y-3">
              {wallets.map((wallet) => (
                <div
                  key={wallet.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={wallet.chain === 'ethereum' ? 'info' : 'secondary'}>
                      {wallet.chain === 'ethereum' ? 'Ethereum' : 'Solana'}
                    </Badge>
                    <div>
                      <div className="font-mono text-sm">
                        {truncateAddress(wallet.address, 8)}
                      </div>
                      {wallet.label && (
                        <div className="text-xs text-gray-500">{wallet.label}</div>
                      )}
                    </div>
                    {wallet.verified_at ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-yellow-500" />
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">
                      Added {formatDate(wallet.created_at)}
                    </span>
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
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-400 text-center py-6">
              No wallets linked yet. Connect one above.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WalletsContent() {
  const [activeTab, setActiveTab] = useState<Tab>('crypto');

  return (
    <AppShell title="Wallets">
      {/* Tab switcher */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('crypto')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'crypto'
              ? 'border-[#207679] text-[#207679]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Wallet className="h-4 w-4" />
          Crypto Wallets
        </button>
        <button
          onClick={() => setActiveTab('bank')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeTab === 'bank'
              ? 'border-[#207679] text-[#207679]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 className="h-4 w-4" />
          Bank Accounts
        </button>
      </div>

      {activeTab === 'crypto' ? (
        <CryptoWalletsTab />
      ) : (
        <BankAccountsTab plaidConfigured={false} />
      )}
    </AppShell>
  );
}

export default function WalletsPage() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletsContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
