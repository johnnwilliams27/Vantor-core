'use client';
import { useMemo, useState } from 'react';
import { EthWalletConnect } from '@/components/wallets/EthWalletConnect';
import { SolWalletConnect } from '@/components/wallets/SolWalletConnect';
import { useWallets, useUnlinkWallet } from '@/hooks/useWallets';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { truncateAddress, formatDate } from '@/lib/utils';
import { Trash2, CheckCircle, Clock, Pencil, Check, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { CardSpinner } from '@/components/ui/spinner';
import { useQueryClient } from '@tanstack/react-query';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger';
import '@solana/wallet-adapter-react-ui/styles.css';

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function CryptoWalletsTab() {
  const { data: wallets, isLoading } = useWallets();
  const { mutateAsync: unlinkWallet, isPending } = useUnlinkWallet();
  const { data: overview } = useTreasuryOverview();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const handleUnlink = async () => {
    if (!deleteTarget) return;
    try {
      await unlinkWallet(deleteTarget.id);
      toast({ title: 'Wallet unlinked', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSaveNickname = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/wallets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editValue.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      toast({ title: 'Nickname saved', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setEditingId(null);
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
            <CardSpinner />
          ) : wallets?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nickname</TableHead>
                    <TableHead>Chain</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallets.map((wallet) => {
                    const positions = overview?.cryptoPositions.filter((p) => p.walletId === wallet.id) ?? [];
                    const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);
                    const isEditing = editingId === wallet.id;
                    return (
                      <TableRow key={wallet.id}>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                placeholder="Enter nickname…"
                                className="h-7 text-sm w-36"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveNickname(wallet.id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                disabled={saving}
                              />
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveNickname(wallet.id)} disabled={saving}>
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)} disabled={saving}>
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{wallet.label || <span className="text-muted-foreground italic">No nickname</span>}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => { setEditingId(wallet.id); setEditValue(wallet.label ?? ''); }}
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={wallet.chain === 'ethereum' ? 'ethereum' : 'solana'}>
                            {wallet.chain === 'ethereum' ? 'Ethereum' : 'Solana'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{truncateAddress(wallet.address, 8)}</TableCell>
                        <TableCell>
                          {wallet.verified_at ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {positions.length > 0 ? (
                            <div>
                              <div className="text-sm font-semibold tabular-nums">{formatUsd(totalUsd)}</div>
                              <div className="text-xs text-muted-foreground">
                                {positions.map((p) => `${p.token} ${Number(p.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })}`).join(' · ')}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDeleteTarget({
                              id: wallet.id,
                              label: wallet.label
                                ? `${wallet.label} (${truncateAddress(wallet.address, 6)})`
                                : truncateAddress(wallet.address, 8),
                            })}
                            disabled={isPending}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-6">
              No wallets linked yet. Connect one above.
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Unlink wallet?"
        description={`Are you sure you want to unlink ${deleteTarget?.label ?? 'this wallet'}? This will remove it from your account and all associated balance data.`}
        confirmLabel="Unlink Wallet"
        isPending={isPending}
        onConfirm={handleUnlink}
      />
    </div>
  );
}

export default function WalletsPage() {
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new LedgerWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <CryptoWalletsTab />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
