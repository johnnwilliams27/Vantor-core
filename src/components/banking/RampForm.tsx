'use client';
import { useState, useEffect, useMemo } from 'react';
import { InlineSuccess } from '@/components/ui/inline-success';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useBalances, useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import { BalanceHint, FiatBalanceHint } from '@/components/ui/balance-hint';
import { FormDivider } from '@/components/ui/form-divider';
import { Loader2, ArrowDownLeft, ArrowUpRight, ArrowDown, CircleAlert } from 'lucide-react';
import { sanitizeErrorMessage } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { BankAccount } from '@/types/database';

interface RampQuote {
  cryptoAmount: number;
  fiatAmount: number;
  exchangeRate: number;
  feeAmount: number;
  vantor_fee?: number;
  fiatCurrency?: string;
  fxRate?: number;
  expiresAt: string;
}

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  bankAccountId: z.string().uuid('Select a bank account'),
  walletId: z.string().uuid('Select a wallet'),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  memo: z.string().max(2000).optional(),
});

type FormData = z.infer<typeof schema>;

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

export function RampForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [pendingHighValue, setPendingHighValue] = useState(false);
  const [quoteSecondsLeft, setQuoteSecondsLeft] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Quote expiry countdown
  useEffect(() => {
    if (!quote) { setQuoteSecondsLeft(null); return; }
    const expiresAt = new Date(quote.expiresAt).getTime();
    const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    setQuoteSecondsLeft(remaining);
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

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });

  const { data: wallets } = useWallets();
  const { data: balances } = useBalances();
  const walletHoldings = useWalletTokenHoldings();

  // Format a bank account's current balance for dropdown labels
  const formatBankBalance = (a: BankAccount): string => {
    if (a.current_balance == null) return '';
    const currency = a.currency || a.balance_currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(parseFloat(a.current_balance));
    } catch {
      return `${currency} ${parseFloat(a.current_balance).toFixed(2)}`;
    }
  };

  const { register, handleSubmit, watch, getValues, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: 'offramp',
      cryptoToken: 'USDC',
      fiatCurrency: 'USD',
    },
  });

  const direction = watch('direction');
  const selectedWalletId = watch('walletId');
  const selectedBankId = watch('bankAccountId');
  const cryptoToken = watch('cryptoToken');
  const fiatCurrency = watch('fiatCurrency');
  const amount = watch('amount');
  const memo = watch('memo');
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);

  // Off-ramp: source is crypto wallet. On-ramp: source is bank account.
  const isOfframp = direction === 'offramp';

  const cryptoBalance = useMemo(() => {
    if (!selectedWalletId || !cryptoToken || !balances) return null;
    const match = balances.find((b) => b.walletId === selectedWalletId && b.token === cryptoToken);
    return match ? parseFloat(match.balance) : 0;
  }, [balances, selectedWalletId, cryptoToken]);

  const selectedBank = bankAccounts?.find((a) => a.id === selectedBankId);

  // Auto-set fiat currency from bank account
  useEffect(() => {
    if (selectedBank?.balance_currency) {
      const bankCurrency = selectedBank.balance_currency as 'USD' | 'EUR' | 'GBP' | 'BRL' | 'MXN';
      if (['USD', 'EUR', 'GBP', 'BRL', 'MXN'].includes(bankCurrency)) {
        setValue('fiatCurrency', bankCurrency);
      }
    }
  }, [selectedBankId, selectedBank, setValue]);
  const bankBalance = selectedBank?.current_balance ? parseFloat(selectedBank.current_balance) : null;

  // Determine if amount exceeds source balance
  const exceeds = useMemo(() => {
    if (!amount) return false;
    const val = parseFloat(amount);
    if (isOfframp && cryptoBalance !== null) return val > cryptoBalance;
    if (!isOfframp && bankBalance !== null) return val > bankBalance;
    return false;
  }, [amount, isOfframp, cryptoBalance, bankBalance]);

  // Clear quote when direction changes
  useEffect(() => { setQuote(null); }, [direction]);

  const getQuote = async () => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', variant: 'destructive' });
      return;
    }
    const data = getValues();
    if (!data.bankAccountId || !data.walletId || !data.amount) return;
    setQuoting(true);
    setQuote(null);
    try {
      const payload: Record<string, unknown> = {
        direction: data.direction,
        cryptoToken: data.cryptoToken,
        fiatCurrency: data.fiatCurrency,
      };
      // Off-ramp: user enters crypto amount. On-ramp: user enters fiat amount.
      if (data.direction === 'offramp') {
        payload.cryptoAmount = parseFloat(data.amount);
      } else {
        payload.fiatAmount = parseFloat(data.amount);
      }
      const res = await fetch('/api/ramps/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  const checkHighValue = (proceed: () => void) => {
    if (parseFloat(amount) >= 100_000) {
      setPendingHighValue(true);
      return;
    }
    proceed();
  };

  const executeRamp = async () => {
    if (!quote) return;
    const data = getValues();
    setExecuting(true);
    try {
      const res = await fetch('/api/ramps/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: data.direction,
          bankAccountId: data.bankAccountId,
          walletId: data.walletId,
          cryptoToken: data.cryptoToken,
          cryptoAmount: quote.cryptoAmount,
          fiatAmount: quote.fiatAmount,
          fiatCurrency: data.fiatCurrency,
          exchangeRate: quote.exchangeRate,
          feeAmount: quote.feeAmount,
          memo: data.memo || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const currSym = { USD: '$', EUR: '€', GBP: '£', BRL: 'R$', MXN: 'MX$' }[data.fiatCurrency] ?? data.fiatCurrency;
      const desc = data.direction === 'offramp'
        ? `${quote.cryptoAmount.toLocaleString()} ${data.cryptoToken} → ${currSym}${quote.fiatAmount.toLocaleString()}`
        : `${currSym}${quote.fiatAmount.toLocaleString()} → ${quote.cryptoAmount} ${data.cryptoToken}`;

      toast({ title: `${data.direction === 'offramp' ? 'Off-ramp' : 'On-ramp'} executed`, description: desc, variant: 'success' });
      setSuccessMessage(isOfframp ? 'Off-ramp executed' : 'On-ramp executed');
      setQuote(null);
      queryClient.invalidateQueries({ queryKey: ['fiat-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });

      // Optimistic insert into ramp history
      queryClient.setQueryData<any[]>(['fiat-transactions'], (old) => {
        if (!old) return old;
        const optimisticRow = {
          id: `optimistic-${Date.now()}`,
          direction: data.direction,
          crypto_amount: String(quote.cryptoAmount),
          crypto_token: data.cryptoToken,
          fiat_amount: String(quote.fiatAmount),
          fiat_currency: data.fiatCurrency,
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        return [optimisticRow, ...old];
      });
    } catch (err) {
      toast({ title: 'Execution failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card className="border-t-2 border-t-teal-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Convert Funds
          <InfoTooltip content="Convert between bank funds and stablecoins." />
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
                  <span className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[10px] font-bold ${i < step ? 'bg-teal-500/20 text-teal-400' : i === step ? 'bg-teal-500 text-white' : 'bg-white/5 text-white/25'}`}>
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
          {/* Direction toggle */}
          <fieldset>
            <legend className="sr-only">Transfer direction</legend>
            <div className="flex rounded-xl bg-white/[0.04] p-1 border border-white/[0.06]">
              <label className="flex-1">
                <input type="radio" value="offramp" {...register('direction')} className="sr-only" />
                <div className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-200 ${direction === 'offramp' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-white/70'}`}>
                  <ArrowUpRight className="h-4 w-4" />
                  Off-ramp
                </div>
              </label>
              <label className="flex-1">
                <input type="radio" value="onramp" {...register('direction')} className="sr-only" />
                <div className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-200 ${direction === 'onramp' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-white/70'}`}>
                  <ArrowDownLeft className="h-4 w-4" />
                  On-ramp
                </div>
              </label>
            </div>
          </fieldset>

          {/* From */}
          <div key={`from-${direction}`} className="space-y-2 animate-in fade-in duration-150">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              From {isOfframp ? '(Stablecoin Wallet)' : '(Bank Account)'}
            </Label>
            {isOfframp ? (
              <>
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
                  <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    {errors.walletId.message}
                  </p>
                )}
              </>
            ) : (
              <>
                <Select {...register('bankAccountId')} aria-required="true">
                  <option value="">Select account…</option>
                  {bankAccounts?.map((a) => {
                    const base = `${a.nickname ? `${a.nickname} – ` : ''}${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`;
                    const bal = formatBankBalance(a);
                    return (
                      <option key={a.id} value={a.id}>
                        {base}{bal ? ` · ${bal}` : ''}
                      </option>
                    );
                  })}
                </Select>
                {!isOfframp && selectedBank && bankBalance !== null && (
                  <FiatBalanceHint
                    balance={bankBalance}
                    currency={selectedBank.balance_currency ?? 'USD'}
                  />
                )}
                {errors.bankAccountId && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    {errors.bankAccountId.message}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center -my-1 relative z-10">
            <div className="w-8 h-8 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* To */}
          <div key={`to-${direction}`} className="space-y-2 animate-in fade-in duration-150">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              To {isOfframp ? '(Bank Account)' : '(Stablecoin Wallet)'}
            </Label>
            {isOfframp ? (
              <>
                <Select {...register('bankAccountId')}>
                  <option value="">Select account…</option>
                  {bankAccounts?.map((a) => {
                    const base = `${a.nickname ? `${a.nickname} – ` : ''}${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`;
                    const bal = formatBankBalance(a);
                    return (
                      <option key={a.id} value={a.id}>
                        {base}{bal ? ` · ${bal}` : ''}
                      </option>
                    );
                  })}
                </Select>
                {errors.bankAccountId && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    {errors.bankAccountId.message}
                  </p>
                )}
              </>
            ) : (
              <>
                <Select {...register('walletId')}>
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
                  <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                    {errors.walletId.message}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Currency + Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {isOfframp ? (
                <>
                  <Label>Token</Label>
                  <Select {...register('cryptoToken')}>
                    <option value="USDC">USDC</option>
                    <option value="USDT">USDT</option>
                  </Select>
                </>
              ) : (
                <>
                  <Label>Currency</Label>
                  <Select {...register('fiatCurrency')}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="BRL">BRL</option>
                    <option value="MXN">MXN</option>
                  </Select>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1000.00" {...register('amount')} aria-required="true" />
              {isOfframp && cryptoBalance !== null && (
                <BalanceHint
                  balance={cryptoBalance}
                  token={cryptoToken ?? 'USDC'}
                  currentAmount={amount}
                  onMax={(max) => setValue('amount', max)}
                />
              )}
              {!isOfframp && selectedBank && bankBalance !== null && (
                <FiatBalanceHint
                  balance={bankBalance}
                  currency={selectedBank.balance_currency ?? 'USD'}
                  currentAmount={amount}
                />
              )}
              {errors.amount && (
                <p className="text-xs text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.amount.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Memo <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Ramp reference…" {...register('memo')} />
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={getQuote} disabled={quoting || exceeds || !selectedWalletId || !selectedBankId || !amount}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote */}
        <div aria-live="polite" aria-atomic="true">
        {quote && (() => {
          const sym = { USD: '$', EUR: '€', GBP: '£', BRL: 'R$', MXN: 'MX$' }[fiatCurrency] ?? fiatCurrency;
          return (
          <div className="mt-4 rounded-xl border border-teal-500/20 bg-[#0a2a2a] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <FormDivider />
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-white">Ramp Quote</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isOfframp ? 'Wallet → Bank' : 'Bank → Wallet'}
                </p>
              </div>
              {quoteSecondsLeft !== null && (
                <span className={`text-xs font-mono ${quoteSecondsLeft <= 10 ? 'text-red-400' : 'text-muted-foreground'}`}>
                  Expires in {quoteSecondsLeft}s
                </span>
              )}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{isOfframp ? 'You send' : 'You pay'}</span>
              <span className="font-mono font-semibold">
                {isOfframp
                  ? `${quote.cryptoAmount.toLocaleString()} ${getValues('cryptoToken')}`
                  : `${sym}${quote.fiatAmount.toLocaleString()}`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">You receive</span>
              <span className="font-mono text-lg font-bold text-teal-400">
                {isOfframp
                  ? `${sym}${quote.fiatAmount.toLocaleString()}`
                  : `${quote.cryptoAmount.toLocaleString()} ${getValues('cryptoToken')}`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Rate</span>
              <span className="font-mono">{sym}{quote.exchangeRate.toFixed(4)} per token</span>
            </div>
            {quote.fxRate && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">FX Rate (USD → {fiatCurrency})</span>
                <span className="font-mono">{quote.fxRate.toFixed(4)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Fee</span>
              <span className="font-mono">{sym}{quote.feeAmount.toFixed(2)}</span>
            </div>
            {quote.vantor_fee != null && quote.vantor_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Vantor fee (0.25%)</span>
                <span className="font-mono">{sym}{Number(quote.vantor_fee).toFixed(2)}</span>
              </div>
            )}
            {quote.vantor_fee != null && quote.vantor_fee > 0 && (
              <div className="flex justify-between text-sm font-medium border-t border-border/50 pt-1 mt-1">
                <span>Total fees</span>
                <span className="font-mono">{sym}{(quote.feeAmount + Number(quote.vantor_fee)).toFixed(2)}</span>
              </div>
            )}
            <Button className="w-full mt-2 btn-gradient" onClick={() => checkHighValue(executeRamp)} disabled={executing}>
              {executing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</>
                : `Execute ${isOfframp ? 'Off-ramp' : 'On-ramp'}`}
            </Button>
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
                You are about to execute a transaction for <span className="font-semibold text-white">{parseFloat(amount || '0').toLocaleString()} {isOfframp ? cryptoToken : fiatCurrency}</span>. This action cannot be reversed.
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPendingHighValue(false)}>Cancel</Button>
              <Button className="btn-gradient" onClick={() => { setPendingHighValue(false); executeRamp(); }}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
