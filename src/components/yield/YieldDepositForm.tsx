'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useYieldProtocols, useYieldDeposit } from '@/hooks/useYield';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance, useBalances } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useToast } from '@/components/ui/toast';

interface Props {
  protocolId: string;
  onBack: () => void;
}

export function YieldDepositForm({ protocolId, onBack }: Props) {
  const { data: protocols } = useYieldProtocols();
  const { data: wallets } = useWallets();
  const deposit = useYieldDeposit();
  const { toast } = useToast();
  const [token, setToken] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');

  const protocol = protocols?.find((p) => p.id === protocolId);
  if (!protocol) return null;

  // Filter wallets by protocol chain
  const { data: allBalances } = useBalances();
  const chainWallets = wallets?.filter((w) => w.chain === protocol.chain) ?? [];
  const selectedWallet = chainWallets.find((w) => w.id === walletId);
  const selectedRate = protocol.rates.find((r) => r.token === token);
  const balance = useWalletTokenBalance(walletId || undefined, token || undefined);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;
  const noBalanceData = walletId && balance === null;

  function walletTokenBal(wId: string): number | null {
    if (!allBalances) return null;
    const match = allBalances.find((b) => b.walletId === wId && b.token === token);
    return match ? parseFloat(match.balance) : 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !selectedWallet) return;

    try {
      await deposit.mutateAsync({
        protocol: protocolId,
        token,
        amount,
        walletAddress: selectedWallet.address,
        chain: protocol.chain,
      });
      toast({ title: 'Deposit successful', variant: 'success' });
      onBack();
    } catch (err) {
      toast({
        title: 'Deposit failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">Deposit to {protocol.name}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">
              Wallet ({protocol.chain === 'solana' ? 'Solana' : 'Ethereum'})
            </label>
            <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="">Select wallet…</option>
              {chainWallets.map((w) => {
                const bal = walletTokenBal(w.id);
                const balLabel = bal !== null
                  ? ` · ${bal.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${token}`
                  : '';
                return (
                  <option key={w.id} value={w.id}>
                    {`${w.label ? `${w.label} · ` : ''}${w.address.slice(0, 6)}…${w.address.slice(-4)}${balLabel}`}
                  </option>
                );
              })}
            </Select>
            {chainWallets.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                No {protocol.chain} wallets connected. Connect one in Wallets first.
              </p>
            )}
            {selectedWallet && (balance === 0 || balance === null) && (
              <p className="text-xs text-amber-400 mt-1">
                {balance === null
                  ? `No ${token} balance data for this wallet. Refresh balances in Wallets to verify funds.`
                  : `This wallet has no ${token} on ${protocol.chain === 'solana' ? 'Solana' : 'Ethereum'}. Check that the token is on the correct chain.`}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Token</label>
            <Select value={token} onChange={(e) => setToken(e.target.value)}>
              {protocol.supportedTokens.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Amount</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="1000.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <BalanceHint
              balance={balance}
              token={token}
              currentAmount={amount}
              onMax={(max) => setAmount(max)}
            />
          </div>

          {selectedRate && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated APY</span>
                <span className="font-semibold text-green-400">
                  {(selectedRate.totalAPY * 100).toFixed(2)}%
                </span>
              </div>
              {amount && parseFloat(amount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Est. Annual Yield</span>
                  <span className="font-medium">
                    ${(parseFloat(amount) * selectedRate.totalAPY).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {protocol.kycRequired && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200">
              This protocol requires KYC verification. Ensure your account is verified with {protocol.name} before depositing.
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={deposit.isPending || !amount || !walletId || exceeds || !!noBalanceData}
          >
            {deposit.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing…
              </>
            ) : (
              `Deposit ${token}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
