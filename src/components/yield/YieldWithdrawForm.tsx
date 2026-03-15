'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useYieldWithdraw, useSlippageCheck } from '@/hooks/useYield';
import { useWallets } from '@/hooks/useWallets';
import { useToast } from '@/components/ui/toast';
import { SlippageWarning } from './SlippageWarning';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { YieldPosition } from '@/types/database';

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho',
  kamino: 'Kamino',
  ondo: 'Ondo (USDY)',
};

interface Props {
  position: YieldPosition;
  onBack: () => void;
}

export function YieldWithdrawForm({ position, onBack }: Props) {
  const withdraw = useYieldWithdraw();
  const slippageCheck = useSlippageCheck();
  const { data: wallets } = useWallets();
  const { toast } = useToast();
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);

  const maxAmount = parseFloat(position.deposited_amount);
  const chainWallets = wallets?.filter((w) => w.chain === position.chain) ?? [];
  const selectedWallet = chainWallets.find((w) => w.id === walletId);

  const executeWithdraw = async () => {
    if (!amount || !selectedWallet) return;
    try {
      await withdraw.mutateAsync({
        positionId: position.id,
        amount,
        walletAddress: selectedWallet.address,
      });
      setSlippageEstimate(null);
      toast({ title: 'Withdrawal successful', variant: 'success' });
      onBack();
    } catch (err) {
      toast({
        title: 'Withdrawal failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !selectedWallet) return;

    try {
      const estimate = await slippageCheck.mutateAsync({
        protocol: position.protocol,
        token: position.underlying_token,
        chain: position.chain,
        amountUsd: parseFloat(amount),
      });

      if (estimate.severity === 'green') {
        await executeWithdraw();
      } else {
        setSlippageEstimate(estimate);
      }
    } catch (err) {
      toast({
        title: 'Slippage check failed',
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
          <CardTitle className="text-lg">
            Withdraw from {PROTOCOL_LABELS[position.protocol] ?? position.protocol}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">
              Withdraw to ({position.chain === 'solana' ? 'Solana' : 'Ethereum'} Wallet)
            </label>
            <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="">Select wallet…</option>
              {chainWallets.map((w) => {
                const chain = w.chain.charAt(0).toUpperCase() + w.chain.slice(1);
                return (
                  <option key={w.id} value={w.id}>
                    {w.label ? `${w.label} · ${chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${chain} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                  </option>
                );
              })}
            </Select>
            {chainWallets.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                No {position.chain} wallets connected. Connect one in Wallets first.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">Amount ({position.underlying_token})</label>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => setAmount(maxAmount.toString())}
              >
                Max: {maxAmount.toLocaleString()}
              </button>
            </div>
            <Input
              type="number"
              step="0.01"
              min="0"
              max={maxAmount}
              placeholder="Amount to withdraw"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position Balance</span>
              <span className="font-medium">${maxAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yield Earned</span>
              <span className="font-medium text-green-600">
                ${parseFloat(position.accrued_yield_usd).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Slippage warning */}
          {slippageEstimate && (
            <SlippageWarning
              estimate={slippageEstimate}
              onConfirm={executeWithdraw}
              onCancel={() => setSlippageEstimate(null)}
              isExecuting={withdraw.isPending}
            />
          )}

          {!slippageEstimate && (
            <Button
              type="submit"
              className="w-full"
              disabled={withdraw.isPending || slippageCheck.isPending || !amount || !walletId}
            >
              {slippageCheck.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking liquidity…
                </>
              ) : withdraw.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : (
                `Withdraw ${position.underlying_token}`
              )}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
