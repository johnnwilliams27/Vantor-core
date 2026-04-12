'use client';
import { useState } from 'react';
import { EthWalletConnect } from '@/components/wallets/EthWalletConnect';
import { SolWalletConnect } from '@/components/wallets/SolWalletConnect';
import { EthereumLogo, SolanaLogo, ChainBadge } from '@/components/ui/icons/chain-logos';
import { useWallets, useUnlinkWallet } from '@/hooks/useWallets';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatDate, truncateAddress } from '@/lib/utils';
import { exportCsv, type ExportColumn } from '@/lib/export';
import { Download } from 'lucide-react';
import { TruncatedAddress } from '@/components/ui/truncated-address';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Trash2, CheckCircle, Clock, Wallet } from 'lucide-react';
import { NicknameEdit } from '@/components/ui/nickname-edit';
import { useToast } from '@/components/ui/toast';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';
import { useQueryClient } from '@tanstack/react-query';

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

interface WalletExportRow {
  nickname: string;
  chain: string;
  address: string;
  status: string;
  balanceUsd: string;
}

const WALLET_EXPORT_COLUMNS: ExportColumn<WalletExportRow>[] = [
  { header: 'Nickname', accessor: (r) => r.nickname },
  { header: 'Chain', accessor: (r) => r.chain },
  { header: 'Address', accessor: (r) => r.address },
  { header: 'Status', accessor: (r) => r.status },
  { header: 'Balance (USD)', accessor: (r) => r.balanceUsd },
];

function CryptoWalletsTab() {
  const { data: wallets, isLoading } = useWallets();
  const { mutateAsync: unlinkWallet, isPending } = useUnlinkWallet();
  const { data: overview } = useTreasuryOverview();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);

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

  const handleSaveNickname = async (id: string, newLabel: string | null) => {
    const res = await fetch(`/api/wallets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const err = new Error(json.error || 'Failed to save');
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      throw err;
    }
    queryClient.invalidateQueries({ queryKey: ['wallets'] });
    toast({ title: 'Nickname saved', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      {/* flex-wrap + min-width lets this grid absorb a third or fourth chain
          card (Base, Polygon, etc.) without a layout rewrite. */}
      <div className="flex flex-wrap gap-6">
        <Card className="border-t-2 border-t-slate-400/40 relative overflow-hidden flex-1 min-w-[280px]">
          {/* Subtle brand watermark */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-6 -bottom-6 opacity-[0.04]"
          >
            <EthereumLogo size={140} />
          </div>
          <CardHeader className="relative">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
                <EthereumLogo size={22} />
              </span>
              <div className="flex-1 min-w-0">
                <CardTitle>Link Ethereum Wallet</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  Connect a self-custody wallet to sign and sync USDC / USDT balances on Ethereum.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 relative">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Supports</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">USDC</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">USDT</Badge>
            </div>
            <div className="h-px bg-white/[0.06]" />
            <EthWalletConnect />
          </CardContent>
        </Card>
        <Card className="border-t-2 border-t-purple-400/40 relative overflow-hidden flex-1 min-w-[280px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-6 -bottom-6 opacity-[0.05]"
          >
            <SolanaLogo size={140} />
          </div>
          <CardHeader className="relative">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] shrink-0">
                <SolanaLogo size={22} />
              </span>
              <div className="flex-1 min-w-0">
                <CardTitle>Link Solana Wallet</CardTitle>
                <p className="text-sm text-muted-foreground mt-1 leading-snug">
                  Connect a self-custody wallet to sign and sync USDC / USDT balances on Solana.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 relative">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Supports</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">USDC</Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">USDT</Badge>
            </div>
            <div className="h-px bg-white/[0.06]" />
            <SolWalletConnect />
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <TableCardSkeleton columns={6} rows={3} />
      ) : (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Linked Wallets</CardTitle>
          {wallets && wallets.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rows: WalletExportRow[] = wallets.map((w) => {
                  const positions = overview?.cryptoPositions.filter((p) => p.walletId === w.id) ?? [];
                  const totalUsd = positions.reduce((sum, p) => sum + p.usdValue, 0);
                  return {
                    nickname: w.label ?? '',
                    chain: w.chain === 'ethereum' ? 'Ethereum' : 'Solana',
                    address: w.address,
                    status: w.verified_at ? `Verified ${formatDate(w.verified_at)}` : 'Pending',
                    balanceUsd: totalUsd > 0 ? totalUsd.toFixed(2) : '',
                  };
                });
                exportCsv('linked-wallets', WALLET_EXPORT_COLUMNS, rows);
              }}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {wallets?.length ? (
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
                    return (
                      <TableRow key={wallet.id}>
                        <TableCell>
                          <NicknameEdit
                            value={wallet.label}
                            onSave={(v) => handleSaveNickname(wallet.id, v)}
                            editAriaLabel={wallet.label ? 'Edit wallet nickname' : 'Add wallet nickname'}
                            requireNonEmpty={false}
                          />
                        </TableCell>
                        <TableCell>
                          <ChainBadge chain={wallet.chain} />
                        </TableCell>
                        <TableCell>
                          <TruncatedAddress address={wallet.address} chars={8} />
                        </TableCell>
                        <TableCell>
                          {wallet.verified_at ? (
                            <InfoTooltip
                              ariaLabel="Verified wallet"
                              content={`Verified — ownership confirmed via on-chain signature on ${formatDate(wallet.verified_at)}.`}
                            >
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            </InfoTooltip>
                          ) : (
                            <InfoTooltip
                              ariaLabel="Pending verification"
                              content="Pending — we're waiting for an on-chain signature to confirm you control this wallet. This usually takes 1–2 minutes after linking."
                            >
                              <Clock className="h-4 w-4 text-yellow-500" />
                            </InfoTooltip>
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
                            aria-label={`Unlink ${wallet.label || 'wallet'}`}
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
            <div className="py-10 text-center space-y-3">
              <Wallet className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No wallets linked yet.</p>
              <p className="text-xs text-muted-foreground">
                Connect an Ethereum or Solana wallet above to start tracking on-chain balances.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      )}

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
  return <CryptoWalletsTab />;
}
