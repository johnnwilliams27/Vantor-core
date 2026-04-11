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
import { useWalletTokenBalance, useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { SlippageWarning } from '@/components/yield/SlippageWarning';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useSlippageCheck } from '@/hooks/useYield';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowRightLeft, ArrowRight, Clock } from 'lucide-react';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { BridgeQuote } from '@/lib/banking/interface';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a source wallet'),
  toWalletId: z.string().uuid('Select a destination wallet'),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  memo: z.string().max(2000).optional(),
});

type FormData = z.infer<typeof schema>;

const CHAIN_LABELS: Record<string, string> = { ethereum: 'Ethereum', solana: 'Solana' };
const PROVIDER_LABELS: Record<string, string> = { bridge: 'Bridge.xyz', cctp: 'Circle CCTP', layerzero: 'LayerZero' };

export function ChainSwapForm() {
  const { data: wallets } = useWallets();
  const walletHoldings = useWalletTokenHoldings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slippageCheck = useSlippageCheck();
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);
  const [showRateApproval, setShowRateApproval] = useState(false);

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

  const providerLabel = 'Bridge.xyz';

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
          memo: data.memo || undefined,
          slippageBps: TOLERANCE_BPS.bridge,
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
    const maxSlippageBps = TOLERANCE_BPS.bridge;

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
          Cross-Chain Bridge
          <InfoTooltip content="Move the same stablecoin across different blockchains." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <div className="space-y-2">
            <Label>Token</Label>
            <Select {...register('token')}>
              <option value="USDC">USDC (via CCTP)</option>
              <option value="USDT">USDT (via LayerZero)</option>
            </Select>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>From Wallet</Label>
              <Select {...register('fromWalletId')}>
                <option value="">Select source...</option>
                {wallets?.map((w) => {
                  const base = `${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain]} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`;
                  const holdings = walletHoldings.get(w.id);
                  const label = formatWalletTokensLabel(holdings);
                  const suffix = label ? ` · ${label}` : '';
                  return (
                    <option key={w.id} value={w.id}>
                      {base}{suffix}
                    </option>
                  );
                })}
              </Select>
              {errors.fromWalletId && <p className="text-sm text-red-500">{errors.fromWalletId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>To Wallet</Label>
              <Select {...register('toWalletId')}>
                <option value="">Select destination...</option>
                {destWallets.map((w) => {
                  const base = `${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain]} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`;
                  const holdings = walletHoldings.get(w.id);
                  const label = formatWalletTokensLabel(holdings);
                  const suffix = label ? ` · ${label}` : '';
                  return (
                    <option key={w.id} value={w.id}>
                      {base}{suffix}
                    </option>
                  );
                })}
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
            <Label>Memo <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Bridge reference…" {...register('memo')} />
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
        {quote && (() => {
          const fromAmt = parseFloat(quote.fromAmount);
          const toAmt = parseFloat(quote.toAmount);
          const effectiveRate = fromAmt > 0 ? toAmt / fromAmt : 1;
          const deviationBps = Math.round(Math.abs(effectiveRate - 1) * 10_000);
          const exceedsTolerance = deviationBps > TOLERANCE_BPS.bridge;

          return (
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

            {exceedsTolerance && (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-md p-2">
                Fee deviation {deviationBps}bps from par (limit: {TOLERANCE_BPS.bridge}bps). Approval required.
              </div>
            )}

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
                onClick={exceedsTolerance ? () => setShowRateApproval(true) : handleExecuteWithSlippageCheck}
                disabled={executing || slippageCheck.isPending}
              >
                {slippageCheck.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking liquidity...</>
                ) : executing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Bridging...</>
                ) : exceedsTolerance ? (
                  'Review & Approve Bridge'
                ) : (
                  `Bridge ${token}`
                )}
              </Button>
            )}
          </div>
          );
        })()}

        {/* Rate deviation approval dialog */}
        <Dialog open={showRateApproval} onOpenChange={setShowRateApproval}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Fee Deviation — Approve Bridge</DialogTitle>
            </DialogHeader>
            {quote && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The bridge fee deviates more than {TOLERANCE_BPS.bridge}bps from the expected 1:1 transfer rate.
                </p>
                <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Send</span>
                    <span className="font-mono font-medium">{quote.fromAmount} {quote.token}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Receive</span>
                    <span className="font-mono font-medium">{quote.toAmount} {quote.token}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fee</span>
                    <span className="font-mono font-medium">{quote.bridgeFee} {quote.token}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Deviation</span>
                    <span className="font-mono font-medium text-amber-600">
                      {Math.round(Math.abs((parseFloat(quote.toAmount) / parseFloat(quote.fromAmount)) - 1) * 10_000)}bps
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proceeding will execute the bridge at the current fee rate.
                </p>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowRateApproval(false)}>Cancel</Button>
              <Button onClick={() => { setShowRateApproval(false); handleExecuteWithSlippageCheck(); }} disabled={executing}>
                {executing ? 'Bridging…' : 'Approve & Bridge'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
