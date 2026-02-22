'use client';
import { useState } from 'react';
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
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeftRight, ArrowRight } from 'lucide-react';
import type { SwapQuoteResponse } from '@/types/api';

const schema = z.object({
  walletId: z.string().uuid('Select a wallet'),
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT', 'PYUSD']),
  toToken: z.enum(['USDC', 'USDT', 'PYUSD']),
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
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { chain: 'solana', fromToken: 'USDC', toToken: 'USDT', slippageBps: '50' },
  });

  const selectedWalletId = watch('walletId');
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);

  const getQuote = async () => {
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
          chain: data.chain,
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
    if (!quote) return;
    const data = getValues();
    setExecuting(true);
    try {
      const res = await fetch('/api/swaps/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId: data.walletId,
          chain: data.chain,
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
    } catch (err) {
      toast({ title: 'Swap failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExecuting(false);
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
              {wallets?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label ?? `${w.chain} – ${w.address.slice(0, 10)}…`}
                </option>
              ))}
            </Select>
            {errors.walletId && <p className="text-sm text-red-500">{errors.walletId.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Chain</Label>
            <Select {...register('chain')}>
              <option value="solana">Solana (Jupiter)</option>
              <option value="ethereum">Ethereum (1inch Fusion)</option>
            </Select>
          </div>

          <div className="grid grid-cols-5 gap-2 items-end">
            <div className="col-span-2 space-y-2">
              <Label>From Token</Label>
              <Select {...register('fromToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="PYUSD">PYUSD</option>
              </Select>
            </div>
            <div className="flex justify-center pb-2">
              <ArrowRight className="h-5 w-5 text-gray-400" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="PYUSD">PYUSD</option>
              </Select>
              {errors.toToken && <p className="text-sm text-red-500">{errors.toToken.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="100.00" {...register('amount')} />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Slippage (bps)</Label>
              <Input placeholder="50" {...register('slippageBps')} />
            </div>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={getQuote} disabled={quoting}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote display */}
        {quote && (
          <div className="mt-4 p-4 rounded-lg bg-teal-50 border border-teal-200 space-y-2">
            <div className="text-sm font-semibold text-teal-900">Quote</div>
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
            <Button className="w-full mt-2" onClick={executeSwap} disabled={executing}>
              {executing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</> : 'Execute Swap'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
