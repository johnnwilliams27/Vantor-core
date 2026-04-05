'use client';
import { useState, useEffect, useMemo } from 'react';
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
import { useBalances } from '@/hooks/useBalances';
import { BalanceHint, FiatBalanceHint } from '@/components/ui/balance-hint';
import { Loader2, ArrowDownLeft, ArrowUpRight, ArrowDown } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
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

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });

  const { data: wallets } = useWallets();
  const { data: balances } = useBalances();

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
      toast({ title: 'Quote failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setQuoting(false);
    }
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
      setQuote(null);
      queryClient.invalidateQueries({ queryKey: ['fiat-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    } catch (err) {
      toast({ title: 'Execution failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Convert Funds
          <InfoTooltip content="Convert between fiat currency and stablecoins." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          {/* Direction toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <label className="flex-1">
              <input type="radio" value="offramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${direction === 'offramp' ? 'bg-muted text-foreground border-r border-border' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground/70 border-r border-border'}`}>
                <ArrowUpRight className="h-4 w-4" />
                Off-ramp (Crypto → Fiat)
              </div>
            </label>
            <label className="flex-1">
              <input type="radio" value="onramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${direction === 'onramp' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground/70'}`}>
                <ArrowDownLeft className="h-4 w-4" />
                On-ramp (Fiat → Crypto)
              </div>
            </label>
          </div>

          {/* From */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              From {isOfframp ? '(Crypto Wallet)' : '(Bank Account)'}
            </Label>
            {isOfframp ? (
              <>
                <Select {...register('walletId')}>
                  <option value="">Select wallet…</option>
                  {wallets?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label ? `${w.label} · ${w.chain.charAt(0).toUpperCase() + w.chain.slice(1)} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${w.chain.charAt(0).toUpperCase() + w.chain.slice(1)} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                    </option>
                  ))}
                </Select>
                {errors.walletId && <p className="text-xs text-red-500">{errors.walletId.message}</p>}
              </>
            ) : (
              <>
                <Select {...register('bankAccountId')}>
                  <option value="">Select account…</option>
                  {bankAccounts?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${a.nickname ? `${a.nickname} – ` : ''}${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`}
                    </option>
                  ))}
                </Select>
                {!isOfframp && selectedBank && bankBalance !== null && (
                  <FiatBalanceHint
                    balance={bankBalance}
                    currency={selectedBank.balance_currency ?? 'USD'}
                  />
                )}
                {errors.bankAccountId && <p className="text-xs text-red-500">{errors.bankAccountId.message}</p>}
              </>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <div className="rounded-full border p-1.5 bg-muted/50">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* To */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              To {isOfframp ? '(Bank Account)' : '(Crypto Wallet)'}
            </Label>
            {isOfframp ? (
              <>
                <Select {...register('bankAccountId')}>
                  <option value="">Select account…</option>
                  {bankAccounts?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${a.nickname ? `${a.nickname} – ` : ''}${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`}
                    </option>
                  ))}
                </Select>
                {errors.bankAccountId && <p className="text-xs text-red-500">{errors.bankAccountId.message}</p>}
              </>
            ) : (
              <>
                <Select {...register('walletId')}>
                  <option value="">Select wallet…</option>
                  {wallets?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label ? `${w.label} · ${w.chain.charAt(0).toUpperCase() + w.chain.slice(1)} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${w.chain.charAt(0).toUpperCase() + w.chain.slice(1)} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                    </option>
                  ))}
                </Select>
                {errors.walletId && <p className="text-xs text-red-500">{errors.walletId.message}</p>}
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
              <Input placeholder="1000.00" {...register('amount')} />
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
              {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Memo <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Ramp reference…" {...register('memo')} />
          </div>

          <Button type="button" className="w-full" onClick={getQuote} disabled={quoting || exceeds || !selectedWalletId || !selectedBankId || !amount}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote */}
        {quote && (() => {
          const sym = { USD: '$', EUR: '€', GBP: '£', BRL: 'R$', MXN: 'MX$' }[fiatCurrency] ?? fiatCurrency;
          return (
          <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
            <div className="text-sm font-semibold">Quote</div>
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
              <span className="font-mono font-semibold text-green-600">
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
                <span className="text-muted-foreground">Vantor fee (0.1%)</span>
                <span className="font-mono">{sym}{Number(quote.vantor_fee).toFixed(2)}</span>
              </div>
            )}
            {quote.vantor_fee != null && quote.vantor_fee > 0 && (
              <div className="flex justify-between text-sm font-medium border-t border-border/50 pt-1 mt-1">
                <span>Total fees</span>
                <span className="font-mono">{sym}{(quote.feeAmount + Number(quote.vantor_fee)).toFixed(2)}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}
            </div>
            <Button className="w-full mt-2" onClick={executeRamp} disabled={executing}>
              {executing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</>
                : `Execute ${isOfframp ? 'Off-ramp' : 'On-ramp'}`}
            </Button>
          </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
