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
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ArrowLeftRight, ArrowRight, ArrowUpDown, CircleAlert } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { SlippageWarning } from '@/components/yield/SlippageWarning';
import { useSlippageCheck } from '@/hooks/useYield';
import type { SlippageEstimate } from '@/lib/yield/slippage';
import type { SwapQuoteResponse } from '@/types/api';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { sanitizeErrorMessage } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const schema = z.object({
  walletId: z.string().uuid('Select a wallet'),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  memo: z.string().max(2000).optional(),
}).refine((d) => d.fromToken !== d.toToken, {
  message: 'From and to tokens must differ',
  path: ['toToken'],
});

type FormData = z.infer<typeof schema>;

export function SwapForm() {
  const { data: wallets } = useWallets();
  const walletHoldings = useWalletTokenHoldings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slippageCheck = useSlippageCheck();
  const [quote, setQuote] = useState<SwapQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [slippageEstimate, setSlippageEstimate] = useState<SlippageEstimate | null>(null);
  const [showRateApproval, setShowRateApproval] = useState(false);
  const [pendingHighValue, setPendingHighValue] = useState(false);
  const [pendingHighValueHandler, setPendingHighValueHandler] = useState<(() => void) | null>(null);
  const [quoteSecondsLeft, setQuoteSecondsLeft] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tokenSwitchHint, setTokenSwitchHint] = useState<string | null>(null);

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
    handleSubmit,
    getValues,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fromToken: 'USDC', toToken: 'USDT' },
  });

  const selectedWalletId = watch('walletId');
  const fromToken = watch('fromToken');
  const toToken = watch('toToken');
  const amount = watch('amount');
  const memo = watch('memo');

  const TOKENS = ['USDC', 'USDT'] as const;
  const toTokenOptions = TOKENS.filter((t) => t !== fromToken);

  // Auto-switch toToken if it matches fromToken
  useEffect(() => {
    if (fromToken && fromToken === toToken) {
      const next = toTokenOptions[0];
      if (next) {
        setValue('toToken', next);
        setTokenSwitchHint(`Switched to ${next}`);
        setTimeout(() => setTokenSwitchHint(null), 3000);
      }
    }
  }, [fromToken]);
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);
  const selectedChain = selectedWallet?.chain;

  // Pre-check slippage when quote loads
  const preCheckedSlippage = useRef<SlippageEstimate | null>(null);
  useEffect(() => {
    if (!quote || !selectedWallet) return;
    preCheckedSlippage.current = null;
    slippageCheck.mutate({
      protocol: 'aave_v3',
      token: fromToken,
      chain: selectedWallet.chain,
      amountUsd: parseFloat(quote.fromAmount),
    }, {
      onSuccess: (estimate) => { preCheckedSlippage.current = estimate; },
    });
  }, [quote]);
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
          slippageBps: TOLERANCE_BPS.swap,
          walletAddress: wallet.address,
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
          memo: data.memo || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Swap recorded', description: `${quote.fromAmount} ${data.fromToken} → ${quote.toAmount} ${data.toToken}`, variant: 'success' });
      setSuccessMessage('Swap executed successfully');
      setQuote(null);
      setSlippageEstimate(null);
      queryClient.invalidateQueries({ queryKey: ['swaps'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });

      // Optimistic insert into swap history
      queryClient.setQueryData<any[]>(['swaps'], (old) => {
        if (!old) return old;
        const optimisticRow = {
          id: `optimistic-${Date.now()}`,
          from_amount: quote.fromAmount,
          from_token: data.fromToken,
          to_amount: quote.toAmount,
          to_token: data.toToken,
          chain: selectedWallet?.chain ?? 'ethereum',
          status: 'completed',
          created_at: new Date().toISOString(),
          rate: quote.rate,
        };
        return [optimisticRow, ...old];
      });
    } catch (err) {
      toast({ title: 'Swap failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
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
    if (!quote || !selectedWallet) return;

    // Use pre-checked result if available (avoids 1-3s delay)
    if (preCheckedSlippage.current) {
      const estimate = preCheckedSlippage.current;
      if (estimate.severity === 'green') {
        await executeSwap();
        return;
      }
      setSlippageEstimate(estimate);
      return;
    }

    // Fall through to live fetch if pre-check wasn't ready
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
    <Card className="border-t-2 border-t-teal-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="h-5 w-5" />
          Token Swap
          <InfoTooltip content="Exchange one stablecoin for another on the same blockchain." />
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
            <Label>Wallet</Label>
            <Select {...register('walletId')} aria-required="true">
              <option value="">Select wallet…</option>
              {wallets?.map((w) => {
                const chain = w.chain.charAt(0).toUpperCase() + w.chain.slice(1);
                const base = w.label
                  ? `${w.label} · ${chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`
                  : `${chain} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
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
            {errors.walletId && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.walletId.message}
              </p>
            )}
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
            <div className="flex flex-col items-center justify-end pb-2 gap-1">
              <button
                type="button"
                onClick={() => {
                  const from = getValues('fromToken');
                  const to = getValues('toToken');
                  setValue('fromToken', to);
                  setValue('toToken', from);
                }}
                className="w-8 h-8 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-white hover:border-white/20 transition-colors mx-auto"
                aria-label="Swap token direction"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                {toTokenOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              {tokenSwitchHint && (
                <p className="text-xs text-teal-400/70 animate-pulse">{tokenSwitchHint}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input placeholder="100.00" {...register('amount')} aria-required="true" />
            <BalanceHint
              balance={balance}
              token={fromToken ?? 'USDC'}
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
            <Input placeholder="Swap reference…" {...register('memo')} />
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={getQuote} disabled={quoting || exceeds || !selectedWalletId || !fromToken || !toToken || !amount}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote display */}
        <div aria-live="polite" aria-atomic="true">
        {quote && (() => {
          const rateVal = parseFloat(quote.rate);
          const deviationBps = Math.round(Math.abs(rateVal - 1) * 10_000);
          const exceedsTolerance = deviationBps > TOLERANCE_BPS.swap;

          return (
          <div className="mt-4 rounded-xl border border-teal-500/20 bg-[#0a2a2a] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <FormDivider />
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Swap Quote</span>
              {quoteSecondsLeft !== null && (
                <span className={`text-xs font-mono ${quoteSecondsLeft <= 10 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  Expires in {quoteSecondsLeft}s
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">You pay</span>
              <span className="font-mono font-semibold">{quote.fromAmount} {quote.fromToken}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono text-lg font-bold text-teal-400">{quote.toAmount} {quote.toToken}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono text-white/70">1 {quote.fromToken} = {quote.rate} {quote.toToken}</span>
            </div>
            {quote.priceImpact && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Price Impact</span>
                <span className="text-orange-400">{quote.priceImpact}%</span>
              </div>
            )}
            {quote.vantor_fee != null && quote.vantor_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Vantor fee (0.25%)</span>
                <span className="text-muted-foreground">${Number(quote.vantor_fee).toFixed(2)}</span>
              </div>
            )}

            {exceedsTolerance && (
              <div className="text-xs text-amber-400 bg-amber-500/10 rounded-md p-2">
                Rate deviates {deviationBps}bps from par (limit: {TOLERANCE_BPS.swap}bps). Approval required.
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
                className="w-full mt-2 btn-gradient"
                onClick={() => checkHighValue(exceedsTolerance ? () => setShowRateApproval(true) : handleExecuteWithSlippageCheck)}
                disabled={executing || slippageCheck.isPending}
              >
                {slippageCheck.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking liquidity…</>
                ) : executing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</>
                ) : exceedsTolerance ? (
                  'Review & Approve Swap'
                ) : (
                  'Execute Swap'
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
                You are about to execute a transaction for <span className="font-semibold text-white">{parseFloat(amount || '0').toLocaleString()} {fromToken}</span>. This action cannot be reversed.
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
              <DialogTitle>Rate Deviation — Approve Swap</DialogTitle>
            </DialogHeader>
            {quote && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The quoted rate deviates more than {TOLERANCE_BPS.swap}bps from the expected 1:1 stablecoin rate.
                </p>
                <div className="text-sm bg-muted/40 rounded-md p-3 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Rate</span>
                    <span className="font-mono font-medium">1.0000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Quoted Rate</span>
                    <span className="font-mono font-medium">{quote.rate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Deviation</span>
                    <span className="font-mono font-medium text-amber-400">
                      {Math.round(Math.abs(parseFloat(quote.rate) - 1) * 10_000)}bps
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Proceeding will execute at the current market rate.
                </p>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button onClick={() => setShowRateApproval(false)}>Cancel</Button>
              <Button onClick={() => { setShowRateApproval(false); handleExecuteWithSlippageCheck(); }} disabled={executing}>
                {executing ? 'Executing…' : 'Approve & Execute'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
