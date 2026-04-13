'use client';
import { useState, useEffect, useRef } from 'react';
import { InlineSuccess } from '@/components/ui/inline-success';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormDivider } from '@/components/ui/form-divider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance, useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { SlippageWarning } from '@/components/yield/SlippageWarning';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useSlippageCheck } from '@/hooks/useYield';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowRightLeft, ArrowRight, Clock, CircleAlert } from 'lucide-react';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { BridgeQuote } from '@/lib/banking/interface';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { sanitizeErrorMessage } from '@/lib/utils';
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
  const [pendingHighValue, setPendingHighValue] = useState(false);
  const [pendingHighValueHandler, setPendingHighValueHandler] = useState<(() => void) | null>(null);
  const [quoteSecondsLeft, setQuoteSecondsLeft] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Quote expiry countdown
  useEffect(() => {
    if (!quote) { setQuoteSecondsLeft(null); return; }
    setQuoteSecondsLeft(60);
    const interval = setInterval(() => {
      setQuoteSecondsLeft((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          setQuote(null);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [quote]);

  // Clear quote if tab was hidden for >60s
  useEffect(() => {
    if (!quote) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
        setQuote(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [quote]);

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
  const memo = watch('memo');

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

  // Pre-check slippage when quote loads
  const preCheckedSlippage = useRef<SlippageEstimate | null>(null);
  useEffect(() => {
    if (!quote || !fromWallet) return;
    preCheckedSlippage.current = null;
    slippageCheck.mutate({
      protocol: 'aave_v3',
      token,
      chain: fromWallet.chain,
      amountUsd: parseFloat(amount),
    }, {
      onSuccess: (estimate) => { preCheckedSlippage.current = estimate; },
    });
  }, [quote]);

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
      toast({ title: 'Quote failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
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
      setSuccessMessage('Bridge transfer initiated');
      setQuote(null);
      setSlippageEstimate(null);
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['bridge-transfers'] });

      // Optimistic insert into bridge history
      queryClient.setQueryData<any[]>(['bridge-transfers'], (old) => {
        if (!old) return old;
        const optimisticRow = {
          id: `optimistic-${Date.now()}`,
          token: data.token,
          amount: data.amount,
          from_chain: fromWallet.chain,
          to_chain: toWallet.chain,
          status: 'pending',
          created_at: new Date().toISOString(),
          bridge_fee: quote.bridgeFee,
          from_wallet: fromWallet,
          to_wallet: toWallet,
        };
        return [optimisticRow, ...old];
      });
    } catch (err) {
      toast({ title: 'Bridge failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  const checkHighValue = (proceed: () => void) => {
    if (parseFloat(amount) >= 100_000) {
      setPendingHighValueHandler(() => proceed);
      setPendingHighValue(true);
      return;
    }
    proceed();
  };

  const handleExecuteWithSlippageCheck = async () => {
    if (!quote || !fromWallet) return;
    const data = getValues();
    const maxSlippageBps = TOLERANCE_BPS.bridge;

    // Use pre-checked result if available (avoids 1-3s delay)
    if (preCheckedSlippage.current) {
      const estimate = preCheckedSlippage.current;
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
        return;
      }
      setSlippageEstimate(estimate);
      return;
    }

    // Fall through to live fetch if pre-check wasn't ready
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
    <Card className="border-t-2 border-t-teal-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5" />
          Cross-Chain Bridge
          <InfoTooltip content="Move the same stablecoin across different blockchains." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-5 text-xs">
          {['Configure', 'Review', 'Execute'].map((label, i) => {
            const step = !quote ? 0 : executing ? 2 : 1;
            return (
              <div key={label} className="flex items-center gap-1.5">
                {i > 0 && <div className={`w-6 h-px ${i <= step ? 'bg-teal-500/60' : 'bg-white/10'}`} />}
                <div className={`flex items-center gap-1 ${i <= step ? 'text-teal-400' : 'text-white/25'}`}>
                  <span className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-3xs font-bold ${i < step ? 'bg-teal-500/20 text-teal-400' : i === step ? 'bg-teal-500 text-white' : 'bg-white/5 text-white/25'}`}>
                    {i + 1}
                  </span>
                  <span className="font-medium">{label}</span>
                </div>
              </div>
            );
          })}
        </div>
        {successMessage && (
          <InlineSuccess message={successMessage} onDismiss={() => setSuccessMessage(null)} />
        )}
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
              <Select {...register('fromWalletId')} aria-required="true">
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
              {errors.fromWalletId && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.fromWalletId.message}
                </p>
              )}
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
              {errors.toWalletId && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.toWalletId.message}
                </p>
              )}
              {sameChain && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  Destination must be on a different chain.
                </p>
              )}
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
            <Input placeholder="1,000.00" {...register('amount')} aria-required="true" />
            <BalanceHint
              balance={balance}
              token={token ?? 'USDC'}
              currentAmount={amount}
              onMax={(max) => setValue('amount', max)}
            />
            {errors.amount && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.amount.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Memo <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Bridge reference…" {...register('memo')} />
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={getQuote}
            disabled={quoting || exceeds || !fromWalletId || !toWalletId || sameChain || !amount}
          >
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote...</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote display */}
        <div aria-live="polite" aria-atomic="true">
        {quote && (() => {
          const fromAmt = parseFloat(quote.fromAmount);
          const toAmt = parseFloat(quote.toAmount);
          const effectiveRate = fromAmt > 0 ? toAmt / fromAmt : 1;
          const deviationBps = Math.round(Math.abs(effectiveRate - 1) * 10_000);
          const exceedsTolerance = deviationBps > TOLERANCE_BPS.bridge;

          return (
          <div className="mt-4 rounded-xl border border-teal-500/20 bg-[#0a2a2a] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <FormDivider />
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Bridge Quote</span>
              {quoteSecondsLeft !== null && (
                <span className={`text-xs font-mono ${quoteSecondsLeft <= 10 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  Expires in {quoteSecondsLeft}s
                </span>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">You send</span>
                <span className="font-mono font-semibold">{quote.fromAmount} {quote.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">You receive</span>
                <span className="font-mono text-lg font-bold text-teal-400">{quote.toAmount} {quote.token}</span>
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
              <div className="text-xs text-amber-400 bg-amber-500/10 rounded-md p-2">
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
                className="w-full mt-2 btn-gradient"
                onClick={() => checkHighValue(exceedsTolerance ? () => setShowRateApproval(true) : handleExecuteWithSlippageCheck)}
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
          </div>
          );
        })()}
        </div>

        {/* High-value transaction confirmation */}
        <Dialog open={pendingHighValue} onOpenChange={setPendingHighValue}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirm Large Transaction</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                You are about to execute a transaction for <span className="font-semibold text-white">{parseFloat(amount || '0').toLocaleString()} {token}</span>. This action cannot be reversed.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button onClick={() => setPendingHighValue(false)}>Cancel</Button>
              <Button className="btn-gradient" onClick={() => { setPendingHighValue(false); pendingHighValueHandler?.(); }}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                    <span className="font-mono font-medium text-amber-400">
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
              <Button onClick={() => setShowRateApproval(false)}>Cancel</Button>
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
