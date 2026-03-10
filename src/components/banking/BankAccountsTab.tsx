'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlaidLinkButton } from './PlaidLinkButton';
import { formatDate } from '@/lib/utils';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { Trash2, CheckCircle, Building2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import type { BankAccount } from '@/types/database';

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

export function BankAccountsTab({ plaidConfigured = false }: { plaidConfigured?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });

  const { data: overview } = useTreasuryOverview();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await fetch(`/api/bank-accounts/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Account removed', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Connect section */}
      <PlaidLinkButton onSuccess={handleRefresh} plaidConfigured={plaidConfigured} />

      {/* Linked bank accounts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Linked Bank Accounts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-gray-400 py-4">Loading…</div>
          ) : !accounts?.length ? (
            <div className="text-sm text-gray-400 text-center py-8">
              No bank accounts connected yet. Add one above.
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((account) => {
                const balanceInfo = overview?.bankAccounts.find((b) => b.id === account.id);
                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm">
                          {account.institution_name}
                          {account.last4 && (
                            <span className="text-muted-foreground ml-1 font-mono">****{account.last4}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {account.account_name} · {account.account_type} · {account.currency}
                        </div>
                      </div>
                      {account.verified_at ? (
                        <Badge variant="success" className="text-xs shrink-0">
                          <CheckCircle className="mr-1 h-3 w-3" />
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-xs shrink-0">Manual</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {balanceInfo != null && (
                        <span className="text-sm font-semibold tabular-nums">
                          {formatUsd(balanceInfo.currentBalanceUsd)}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground hidden sm:block">
                        Added {formatDate(account.created_at)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(account.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
