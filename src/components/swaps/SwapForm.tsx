'use client';
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { SlippageWarning } from '@/components/yield/SlippageWarning';
import { useSlippageCheck } from '@/hooks/useYield';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { SwapQuoteResponse } from '@/types/api';

const schema = z.object({
  walletId: z.string().uuid('Select a wallet'),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  slippageBps: z.string().optional(),
}).refine((d) => d.fromToken !== d.toToken, {
  message: 'From and to tokens must differ',
  path: ['toToken'],
});

type FormData = z.infer<typeof schema>;

export function SwapForm() {
  const { data: wallets } = useWallets();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slippageCheck = useSlippageCheck();
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fromToken: 'USDC', toToken: 'USDT', slippageBps: '50' },
  });

  const selectedWalletId = watch('walletId');
  const fromToken = watch('fromToken');
  const toToken = watch('toToken');
  const amount = watch('amount');

  const TOKENS = ['USDC', 'USDT'] as const;
  const toTokenOptions = TOKENS.filter((t) => t !== fromToken);

  // Auto-switch toToken if it matches fromToken
  useEffect(() => {
    if (fromToken && fromToken === toToken) {
      const next = toTokenOptions[0];
      if (next) setValue('toToken', next);
    }
  }, [fromToken]);
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);
  const selectedChain = selectedWallet?.chain;
  const dexLabel = selectedChain ? 'Bridge.xyz' : null;
  const balance = useWalletTokenBalance(selectedWalletId, fromToken);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const getQuote = async () => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${fromToken} in this wallet.`, variant: 'destructive' });
      return;
    }
    const data = getValues();
    const wallet = wallets?.find((w) => w.id === data.walletId);
    if (!wallet) return;
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch('/api/swaps/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: wallet.chain,
          fromToken: data.fromToken,
          toToken: data.toToken,
          amount: data.amount,
          slippageBps: data.slippageBps ? parseInt(data.slippageBps) : 50,
          walletAddress: wallet.address,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setQuote(json.data);
    } catch (err) {
      toast({ title: 'Quote failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setQuoting(false);
    }
  };

  const executeSwap = async () => {
    if (!quote || !selectedWallet) return;
    const data = getValues();
    setExecuting(true);
    try {
      const res = await fetch('/api/swaps/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId: data.walletId,
          chain: selectedWallet.chain,
          fromToken: data.fromToken,
          toToken: data.toToken,
          fromAmount: quote.fromAmount,
          toAmount: quote.toAmount,
          quoteData: quote.quoteData,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Swap recorded', description: `${quote.fromAmount} ${data.fromToken} → ${quote.toAmount} ${data.toToken}`, variant: 'success' });
      setQuote(null);
      setSlippageEstimate(null);
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    } catch (err) {
      toast({ title: 'Swap failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteWithSlippageCheck = async () => {
    if (!quote || !selectedWallet) return;
    try {
      const estimate = await slippageCheck.mutateAsync({
        protocol: 'aave_v3', // Use deep-liquidity protocol as proxy
        token: fromToken,
        chain: selectedWallet.chain,
        amountUsd: parseFloat(quote.fromAmount),
      });

      if (estimate.severity === 'green') {
        await executeSwap();
      } else {
        setSlippageEstimate(estimate);
      }
    } catch {
      // If slippage check fails, proceed without it
      await executeSwap();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          Token Swap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="space-y-2">
            <Label>Wallet</Label>
            <Select {...register('walletId')}>
              <option value="">Select wallet…</option>
              {wallets?.map((w) => {
                const chain = w.chain.charAt(0).toUpperCase() + w.chain.slice(1);
                return (
                  <option key={w.id} value={w.id}>
                    {w.label ? `${w.label} · ${chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${chain} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                  </option>
                );
              })}
            </Select>
            {errors.walletId && <p className="text-sm text-red-500">{errors.walletId.message}</p>}
            {dexLabel && (
              <p className="text-xs text-muted-foreground">Provider: {dexLabel}</p>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2 items-end">
            <div className="col-span-2 space-y-2">
              <Label>From Token</Label>
              <Select {...register('fromToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
            </div>
            <div className="flex justify-center pb-2">
              <ArrowRight className="h-5 w-5 text-gray-400" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                {toTokenOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="100.00" {...register('amount')} />
              <BalanceHint
                balance={balance}
                token={fromToken ?? 'USDC'}
                currentAmount={amount}
                onMax={(max) => setValue('amount', max)}
              />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5">
                Slippage (bps)
                <InfoTooltip content="Slippage tolerance in basis points (1 bps = 0.01%). This is the maximum price change you'll accept between submitting and executing the swap. For stablecoins, 50 bps (0.5%) is typical." />
              </Label>
              <Input placeholder="50" {...register('slippageBps')} />
            </div>
          </div>

          <Button type="button" className="w-full" onClick={getQuote} disabled={quoting || exceeds}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote display */}
        {quote && (
          <div className="mt-4 p-4 rounded-lg bg-[#19595b]/5 border border-[#19595b]/20 space-y-2">
            <div className="text-sm font-semibold text-[#134849]">Quote</div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">You pay</span>
              <span className="font-mono font-semibold">{quote.fromAmount} {quote.fromToken}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">You receive</span>
              <span className="font-mono font-semibold text-green-700">{quote.toAmount} {quote.toToken}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Rate</span>
              <span className="font-mono text-gray-700">1 {quote.fromToken} = {quote.rate} {quote.toToken}</span>
            </div>
            {quote.priceImpact && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Price Impact</span>
                <span className="text-orange-600">{quote.priceImpact}%</span>
              </div>
            )}
            {quote.vantor_fee != null && quote.vantor_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Vantor fee (0.1%)</span>
                <span className="text-muted-foreground">${Number(quote.vantor_fee).toFixed(2)}</span>
              </div>
            )}
            {/* Slippage warning */}
            {slippageEstimate && (
              <SlippageWarning
                estimate={slippageEstimate}
                onConfirm={executeSwap}
                onCancel={() => setSlippageEstimate(null)}
                isExecuting={executing}
              />
            )}

            {!slippageEstimate && (
              <Button
                className="w-full mt-2"
                onClick={handleExecuteWithSlippageCheck}
                disabled={executing || slippageCheck.isPending}
              >
                {slippageCheck.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking liquidity…</>
                ) : executing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</>
                ) : (
                  'Execute Swap'
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
