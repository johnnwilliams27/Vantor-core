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
import { Trash2, CheckCircle, Building2, Pencil, Check, X } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handleSaveNickname = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/bank-accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: editValue.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to save');
      }
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
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
      {/* Connect section */}
      <BankLinkButton onSuccess={handleRefresh} bankingProvider={bankingProvider} />

      {/* Linked bank accounts */}
      {isLoading ? (
        <TableCardSkeleton columns={7} rows={3} />
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Linked Bank Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!accounts?.length ? (
            <div className="text-sm text-gray-400 text-center py-8">
              No bank accounts connected yet. Add one above.
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
                    const isEditing = editingId === account.id;
                    return (
                      <TableRow key={account.id}>
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
                                  if (e.key === 'Enter') handleSaveNickname(account.id);
                                  if (e.key === 'Escape') setEditingId(null);
                                }}
                                disabled={saving}
                              />
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveNickname(account.id)} disabled={saving} aria-label="Save nickname">
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)} disabled={saving} aria-label="Cancel edit">
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{account.nickname || <span className="text-muted-foreground italic">No nickname</span>}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => { setEditingId(account.id); setEditValue(account.nickname ?? ''); }}
                                aria-label={account.nickname ? 'Edit bank account nickname' : 'Add bank account nickname'}
                              >
                                <Pencil className="h-3 w-3 text-muted-foreground" />
                              </Button>
                            </div>
                          )}
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
                              <Badge variant="success" className="text-xs">
                                <CheckCircle className="mr-1 h-3 w-3" />
                                Verified
                              </Badge>
                            </InfoTooltip>
                          ) : (
                            <InfoTooltip
                              ariaLabel="Manual bank account"
                              content="Manual — entered by you for reference. Vantor cannot sync balances or initiate transfers on manual accounts."
                            >
                              <Badge variant="warning" className="text-xs">Manual</Badge>
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
