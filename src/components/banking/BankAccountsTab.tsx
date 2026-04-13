'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BankLinkButton } from './BankLinkButton';
import { formatDate } from '@/lib/utils';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { Trash2, CheckCircle, Building2, Download } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { NicknameEdit } from '@/components/ui/nickname-edit';
import { exportCsv, type ExportColumn } from '@/lib/export';
import { useToast } from '@/components/ui/toast';
import type { BankAccount } from '@/types/database';
import { TableCardSkeleton } from '@/components/ui/operations-skeletons';

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

function formatCurrencyAmount(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
}

const PROVIDER_ATTRIBUTION: Record<BankAccount['banking_provider'], string> = {
  stripe_fc: 'via Stripe',
  belvo: 'via Belvo',
  manual: 'Manual entry',
};

interface BankExportRow {
  nickname: string;
  institution: string;
  accountType: string;
  currency: string;
  status: string;
  provider: string;
  balance: string;
}

const BANK_EXPORT_COLUMNS: ExportColumn<BankExportRow>[] = [
  { header: 'Nickname', accessor: (r) => r.nickname },
  { header: 'Institution', accessor: (r) => r.institution },
  { header: 'Type', accessor: (r) => r.accountType },
  { header: 'Currency', accessor: (r) => r.currency },
  { header: 'Status', accessor: (r) => r.status },
  { header: 'Linked via', accessor: (r) => r.provider },
  { header: 'Balance', accessor: (r) => r.balance },
];

const PROVIDER_TOOLTIP: Record<BankAccount['banking_provider'], string> = {
  stripe_fc:
    'Linked through Stripe Financial Connections. Balances and transactions sync automatically.',
  belvo:
    'Linked through Belvo (Latin America open banking). Balances and transactions sync automatically.',
  manual:
    'Entered manually. Reference only — Vantor cannot sync balances or transactions for manual accounts.',
};

export function BankAccountsTab({ bankingProvider = 'stripe_fc' }: { bankingProvider?: 'stripe_fc' | 'belvo' | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });

  const { data: overview } = useTreasuryOverview();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
  };

  const handleRemove = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/bank-accounts/${deleteTarget.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Account removed', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview'] });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleSaveNickname = async (id: string, newNickname: string | null) => {
    const res = await fetch(`/api/bank-accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: newNickname }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const err = new Error(json.error || 'Failed to save');
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
      throw err;
    }
    queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    toast({ title: 'Nickname saved', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      {/* Connect section */}
      <BankLinkButton onSuccess={handleRefresh} bankingProvider={bankingProvider} />

      {/* Linked bank accounts */}
      {isLoading ? (
        <TableCardSkeleton columns={7} rows={3} />
      ) : (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Linked Bank Accounts
          </CardTitle>
          {accounts && accounts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rows: BankExportRow[] = accounts.map((a) => {
                  const balanceInfo = overview?.bankAccounts.find((b) => b.id === a.id);
                  const cur = a.currency ?? a.balance_currency ?? 'USD';
                  const balance =
                    balanceInfo != null
                      ? formatCurrencyAmount(balanceInfo.currentBalanceUsd, cur)
                      : a.current_balance
                        ? formatCurrencyAmount(parseFloat(a.current_balance), cur)
                        : '';
                  return {
                    nickname: a.nickname ?? '',
                    institution: `${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`,
                    accountType: a.account_type ?? '',
                    currency: a.currency ?? '',
                    status: a.verified_at ? `Verified ${formatDate(a.verified_at)}` : 'Manual',
                    provider: PROVIDER_ATTRIBUTION[a.banking_provider],
                    balance,
                  };
                });
                exportCsv('linked-bank-accounts', BANK_EXPORT_COLUMNS, rows);
              }}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!accounts?.length ? (
            <div className="py-10 text-center space-y-3">
              <Building2 className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No bank accounts connected yet.</p>
              <p className="text-xs text-muted-foreground">
                Connect a bank above to sync balances and enable fiat payments.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nickname</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => {
                    const balanceInfo = overview?.bankAccounts.find((b) => b.id === account.id);
                    return (
                      <TableRow key={account.id}>
                        <TableCell>
                          <NicknameEdit
                            value={account.nickname}
                            onSave={(v) => handleSaveNickname(account.id, v)}
                            editAriaLabel={account.nickname ? 'Edit bank account nickname' : 'Add bank account nickname'}
                            requireNonEmpty={false}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">
                            {account.institution_name}
                            {account.last4 && (
                              <span className="text-muted-foreground ml-1 font-mono">****{account.last4}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                            <span>{PROVIDER_ATTRIBUTION[account.banking_provider]}</span>
                            <InfoTooltip
                              ariaLabel={`${PROVIDER_ATTRIBUTION[account.banking_provider]} — more info`}
                              content={PROVIDER_TOOLTIP[account.banking_provider]}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-sm capitalize">{account.account_type}</TableCell>
                        <TableCell>
                          <Badge variant={(account.currency?.toLowerCase() as 'usd' | 'eur' | 'gbp' | 'brl' | 'mxn') ?? 'default'}>
                            {account.currency}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {account.verified_at ? (
                            <InfoTooltip
                              ariaLabel="Verified bank account"
                              content={`Verified — ownership confirmed via the banking provider on ${formatDate(account.verified_at)}. Balance sync active.`}
                            >
                              <Badge variant="active" className="text-xs">
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Verified
                              </Badge>
                            </InfoTooltip>
                          ) : (
                            <InfoTooltip
                              ariaLabel="Manual bank account"
                              content="Manual — entered by you for reference. Vantor cannot sync balances or initiate transfers on manual accounts."
                            >
                              <Badge variant="pending" className="text-xs">Manual</Badge>
                            </InfoTooltip>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {(() => {
                            const cur = account.currency ?? account.balance_currency ?? 'USD';
                            if (balanceInfo != null) {
                              return <span className="text-sm font-semibold tabular-nums">{formatCurrencyAmount(balanceInfo.currentBalanceUsd, cur)}</span>;
                            }
                            if (account.current_balance) {
                              return <span className="text-sm font-semibold tabular-nums">{formatCurrencyAmount(parseFloat(account.current_balance), cur)}</span>;
                            }
                            return <span className="text-muted-foreground">—</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setDeleteTarget({
                              id: account.id,
                              label: `${account.institution_name}${account.last4 ? ` ****${account.last4}` : ''}`,
                            })}
                            disabled={isDeleting}
                            aria-label={`Remove ${account.institution_name} account`}
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
          )}
        </CardContent>
      </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove bank account?"
        description={`Are you sure you want to remove ${deleteTarget?.label ?? 'this bank account'}? It will be deactivated and no longer appear in your account.`}
        confirmLabel="Remove Account"
        isPending={isDeleting}
        onConfirm={handleRemove}
      />
    </div>
  );
}
