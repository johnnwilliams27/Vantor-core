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
import { SlippageWarning } from '@/components/yield/SlippageWarning';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useSlippageCheck } from '@/hooks/useYield';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowRightLeft, ArrowRight, Clock } from 'lucide-react';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { BridgeQuoteResponse } from '@/lib/bridges/interface';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a source wallet'),
  toWalletId: z.string().uuid('Select a destination wallet'),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  slippageBps: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const CHAIN_LABELS: Record<string, string> = { ethereum: 'Ethereum', solana: 'Solana' };
const PROVIDER_LABELS: Record<string, string> = { cctp: 'Circle CCTP', layerzero: 'LayerZero OFT' };

export function ChainSwapForm() {
  const { data: wallets } = useWallets();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slippageCheck = useSlippageCheck();
  const [quote, setQuote] = useState<BridgeQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);

  const {
    register,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { token: 'USDC' },
  });

  const fromWalletId = watch('fromWalletId');
  const toWalletId = watch('toWalletId');
  const token = watch('token');
  const amount = watch('amount');

  const fromWallet = wallets?.find((w) => w.id === fromWalletId);
  const toWallet = wallets?.find((w) => w.id === toWalletId);
  const fromChain = fromWallet?.chain;
  const toChain = toWallet?.chain;
  const sameChain = fromChain && toChain && fromChain === toChain;

  const balance = useWalletTokenBalance(fromWalletId, token);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  // Filter destination wallets to different chain
  const destWallets = wallets?.filter((w) =>
    fromWallet ? w.chain !== fromWallet.chain : true
  ) ?? [];

  // Reset destination wallet if it's now on the same chain
  useEffect(() => {
    if (sameChain && toWalletId) {
      setValue('toWalletId', '' as any);
    }
  }, [fromWalletId]);

  // Clear quote when inputs change
  useEffect(() => {
    setQuote(null);
    setSlippageEstimate(null);
  }, [token, amount, fromWalletId, toWalletId]);

  const providerLabel = token === 'USDC' ? 'Circle CCTP' : 'LayerZero OFT';

  const getQuote = async () => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${token}.`, variant: 'destructive' });
      return;
    }
    const data = getValues();
    if (!fromWallet || !toWallet) return;

    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch('/api/bridges/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: data.token,
          amount: data.amount,
          fromChain: fromWallet.chain,
          toChain: toWallet.chain,
          walletAddress: fromWallet.address,
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

  const executeBridge = async () => {
    if (!quote || !fromWallet || !toWallet) return;
    const data = getValues();

    setExecuting(true);
    try {
      const res = await fetch('/api/bridges/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromWalletId: data.fromWalletId,
          toWalletId: data.toWalletId,
          token: data.token,
          amount: data.amount,
          fromChain: fromWallet.chain,
          toChain: toWallet.chain,
          quoteData: quote.quoteData,
          bridgeFee: quote.bridgeFee,
          slippageBps: data.slippageBps ? parseInt(data.slippageBps) : 50,
          ...(slippageEstimate && {
            slippage: {
              estimated_slippage_bps: slippageEstimate.estimatedSlippageBps,
              pool_liquidity_usd: slippageEstimate.poolLiquidity.availableLiquidityUsd,
              severity: slippageEstimate.severity,
              user_acknowledged: true,
            },
          }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const arrival = json.data.estimatedArrivalMinutes;
      toast({
        title: 'Bridge transfer initiated',
        description: `${data.amount} ${data.token} from ${CHAIN_LABELS[fromWallet.chain]} → ${CHAIN_LABELS[toWallet.chain]}. Estimated arrival: ~${arrival} min.`,
        variant: 'success',
      });
      setQuote(null);
      setSlippageEstimate(null);
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['bridge-transfers'] });
    } catch (err) {
      toast({ title: 'Bridge failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteWithSlippageCheck = async () => {
    if (!quote || !fromWallet) return;
    const data = getValues();
    const maxSlippageBps = data.slippageBps ? parseInt(data.slippageBps) : 50;

    try {
      const estimate = await slippageCheck.mutateAsync({
        protocol: 'aave_v3',
        token,
        chain: fromWallet.chain,
        amountUsd: parseFloat(amount),
      });

      // Enforce user's slippage tolerance
      if (estimate.estimatedSlippageBps > maxSlippageBps) {
        toast({
          title: 'Slippage exceeds tolerance',
          description: `Estimated slippage (${estimate.estimatedSlippageBps.toFixed(1)} bps) exceeds your maximum (${maxSlippageBps} bps). Reduce amount or increase tolerance.`,
          variant: 'destructive',
        });
        setSlippageEstimate(estimate);
        return;
      }

      if (estimate.severity === 'green') {
        await executeBridge();
      } else {
        setSlippageEstimate(estimate);
      }
    } catch {
      await executeBridge();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5" />
          Chain Bridge
          <InfoTooltip content="Transfer the same token between chains. USDC uses Circle CCTP for native cross-chain transfers. USDT and PYUSD use LayerZero OFT." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="space-y-2">
            <Label>Token</Label>
            <Select {...register('token')}>
              <option value="USDC">USDC (via CCTP)</option>
              <option value="USDT">USDT (via LayerZero)</option>
              <option value="PYUSD">PYUSD (via LayerZero)</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Wallet</Label>
              <Select {...register('fromWalletId')}>
                <option value="">Select source...</option>
                {wallets?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain]} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`}
                  </option>
                ))}
              </Select>
              {errors.fromWalletId && <p className="text-sm text-red-500">{errors.fromWalletId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>To Wallet</Label>
              <Select {...register('toWalletId')}>
                <option value="">Select destination...</option>
                {destWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain]} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`}
                  </option>
                ))}
              </Select>
              {errors.toWalletId && <p className="text-sm text-red-500">{errors.toWalletId.message}</p>}
              {sameChain && <p className="text-sm text-red-500">Destination must be on a different chain.</p>}
            </div>
          </div>

          {fromChain && toChain && !sameChain && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{CHAIN_LABELS[fromChain]}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-medium">{CHAIN_LABELS[toChain]}</span>
              <span className="text-border">|</span>
              <span>Bridge: {providerLabel}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1,000.00" {...register('amount')} />
              <BalanceHint
                balance={balance}
                token={token ?? 'USDC'}
                currentAmount={amount}
                onMax={(max) => setValue('amount', max)}
              />
            {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label className="inline-flex items-center gap-1.5">
                Slippage (bps)
                <InfoTooltip content="Maximum slippage tolerance in basis points (1 bps = 0.01%). The bridge will be blocked if estimated slippage exceeds this value. Default is 50 bps (0.5%)." />
              </Label>
              <Input placeholder="50" {...register('slippageBps')} />
            </div>
          </div>

          <Button
            type="button"
            className="w-full"
            onClick={getQuote}
            disabled={quoting || exceeds || !fromWalletId || !toWalletId || sameChain || !amount}
          >
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote...</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote display */}
        {quote && (
          <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-3">
            <div className="text-sm font-semibold">Bridge Quote</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">You send</span>
                <span className="font-mono font-semibold">{quote.fromAmount} {quote.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">You receive</span>
                <span className="font-mono font-semibold text-green-600">{quote.toAmount} {quote.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bridge fee</span>
                <span className="font-mono">{quote.bridgeFee} {quote.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated time</span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  ~{quote.estimatedTimeMinutes} min
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider</span>
                <span>{PROVIDER_LABELS[quote.provider]}</span>
              </div>
            </div>

            {/* Slippage warning */}
            {slippageEstimate && (
              <SlippageWarning
                estimate={slippageEstimate}
                onConfirm={executeBridge}
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
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking liquidity...</>
                ) : executing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Bridging...</>
                ) : (
                  `Bridge ${token}`
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
