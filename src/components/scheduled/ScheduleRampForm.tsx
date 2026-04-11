'use client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { Loader2, Calendar, ArrowDownLeft, ArrowUpRight, ArrowDown } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { useCreateScheduledOperation } from '@/hooks/useScheduledOperations';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import type { BankAccount } from '@/types/database';

function formatBankBalance(a: BankAccount): string {
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
}

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  walletId: z.string().uuid('Select a wallet'),
  bankAccountId: z.string().uuid('Select a bank account'),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function ScheduleRampForm() {
  const { toast } = useToast();
  const createOp = useCreateScheduledOperation();

  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });

  const { data: wallets } = useWallets();
  const walletHoldings = useWalletTokenHoldings();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: 'offramp',
      cryptoToken: 'USDC',
      fiatCurrency: 'USD',
    },
  });

  const direction = watch('direction');
  const selectedBankId = watch('bankAccountId');
  const isOfframp = direction === 'offramp';

  const selectedBank = bankAccounts?.find((a) => a.id === selectedBankId);

  // Auto-set fiat currency from bank account
  useEffect(() => {
    if (selectedBank?.balance_currency) {
      const bankCurrency = selectedBank.balance_currency as 'USD' | 'EUR' | 'GBP';
      if (['USD', 'EUR', 'GBP'].includes(bankCurrency)) {
        setValue('fiatCurrency', bankCurrency);
      }
    }
  }, [selectedBankId, selectedBank, setValue]);

  const onSubmit = async (data: FormData) => {
    try {
      await createOp.mutateAsync({
        type: 'ramp',
        scheduledFor: new Date(data.scheduledFor).toISOString(),
        memo: data.memo,
        params: {
          direction: data.direction,
          cryptoToken: data.cryptoToken,
          fiatCurrency: data.fiatCurrency,
          cryptoAmount: parseFloat(data.amount),
          bankAccountId: data.bankAccountId,
          walletId: data.walletId,
        },
      });
      toast({ title: 'Ramp scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
      reset();
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const walletSelect = (
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
  );

  const bankSelect = (
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
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule Ramp
          <InfoTooltip content="Convert between fiat currency and stablecoins. Scheduled for a future date." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Direction toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <label className="flex-1">
              <input type="radio" value="offramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${isOfframp ? 'bg-muted text-foreground border-r border-border' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground/70 border-r border-border'}`}>
                <ArrowUpRight className="h-4 w-4" />
                Off-ramp (Crypto → Fiat)
              </div>
            </label>
            <label className="flex-1">
              <input type="radio" value="onramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${!isOfframp ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground/70'}`}>
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
            {isOfframp ? walletSelect : bankSelect}
            {isOfframp && errors.walletId && <p className="text-xs text-red-500">{errors.walletId.message}</p>}
            {!isOfframp && errors.bankAccountId && <p className="text-xs text-red-500">{errors.bankAccountId.message}</p>}
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
            {isOfframp ? bankSelect : walletSelect}
            {isOfframp && errors.bankAccountId && <p className="text-xs text-red-500">{errors.bankAccountId.message}</p>}
            {!isOfframp && errors.walletId && <p className="text-xs text-red-500">{errors.walletId.message}</p>}
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
                  </Select>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1000.00" {...register('amount')} />
              {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
            </div>
          </div>

          {/* Schedule For */}
          <div className="space-y-2">
            <Label>Schedule For</Label>
            <DateTimePicker
              value={watch('scheduledFor') ?? ''}
              onChange={(v) => setValue('scheduledFor', v, { shouldValidate: true })}
            />
            {errors.scheduledFor && <p className="text-xs text-red-500">{errors.scheduledFor.message}</p>}
          </div>

          {/* Memo */}
          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Ramp reference…" {...register('memo')} />
          </div>

          <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
            Auto-executes within 50bps of quoted rate. If rate deviates further, you&apos;ll be asked to approve.
          </p>

          <Button type="submit" className="w-full" disabled={createOp.isPending || !watch('walletId') || !watch('bankAccountId') || !watch('amount') || !watch('scheduledFor')}>
            {createOp.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              `Schedule ${isOfframp ? 'Off-ramp' : 'On-ramp'}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
