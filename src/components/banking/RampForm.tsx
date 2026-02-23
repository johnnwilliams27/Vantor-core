'use client';
import { useState, useEffect } from 'react';
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
import { Loader2, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { BankAccount } from '@/types/database';

interface RampQuote {
  cryptoAmount: number;
  fiatAmount: number;
  exchangeRate: number;
  feeAmount: number;
  expiresAt: string;
}

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  bankAccountId: z.string().uuid('Select a bank account'),
  cryptoToken: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  amountType: z.enum(['crypto', 'fiat']),
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

  const { register, handleSubmit, watch, getValues, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: 'offramp',
      cryptoToken: 'USDC',
      amountType: 'crypto',
    },
  });

  const direction = watch('direction');

  // Clear quote when direction changes
  useEffect(() => { setQuote(null); }, [direction]);

  const getQuote = async () => {
    const data = getValues();
    if (!data.bankAccountId || !data.amount) return;
    setQuoting(true);
    setQuote(null);
    try {
      const payload: Record<string, unknown> = {
        direction: data.direction,
        cryptoToken: data.cryptoToken,
        fiatCurrency: 'USD',
      };
      if (data.amountType === 'crypto') {
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
          cryptoToken: data.cryptoToken,
          cryptoAmount: quote.cryptoAmount,
          fiatAmount: quote.fiatAmount,
          fiatCurrency: 'USD',
          exchangeRate: quote.exchangeRate,
          feeAmount: quote.feeAmount,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const desc = data.direction === 'offramp'
        ? `${quote.cryptoAmount} ${data.cryptoToken} → $${quote.fiatAmount.toLocaleString()}`
        : `$${quote.fiatAmount.toLocaleString()} → ${quote.cryptoAmount} ${data.cryptoToken}`;

      toast({ title: `${data.direction === 'offramp' ? 'Off-ramp' : 'On-ramp'} executed`, description: desc, variant: 'success' });
      setQuote(null);
      queryClient.invalidateQueries({ queryKey: ['fiat-transactions'] });
    } catch (err) {
      toast({ title: 'Execution failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Convert Funds</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          {/* Direction toggle */}
          <div className="flex rounded-lg border overflow-hidden">
            <label className="flex-1">
              <input type="radio" value="offramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${direction === 'offramp' ? 'bg-orange-50 text-orange-700 border-r border-orange-200' : 'text-gray-500 hover:bg-gray-50 border-r'}`}>
                <ArrowUpRight className="h-4 w-4" />
                Off-ramp (crypto → fiat)
              </div>
            </label>
            <label className="flex-1">
              <input type="radio" value="onramp" {...register('direction')} className="sr-only" />
              <div className={`flex items-center justify-center gap-2 py-2 text-sm font-medium cursor-pointer transition-colors ${direction === 'onramp' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                <ArrowDownLeft className="h-4 w-4" />
                On-ramp (fiat → crypto)
              </div>
            </label>
          </div>

          {/* Bank account */}
          <div className="space-y-2">
            <Label>Bank Account</Label>
            <Select {...register('bankAccountId')}>
              <option value="">Select account…</option>
              {bankAccounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.institution_name} – {a.account_name}{a.last4 ? ` ****${a.last4}` : ''}
                </option>
              ))}
            </Select>
            {errors.bankAccountId && <p className="text-xs text-red-500">{errors.bankAccountId.message}</p>}
          </div>

          {/* Token + amount */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Token</Label>
              <Select {...register('cryptoToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="PYUSD">PYUSD</option>
              </Select>
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Amount</Label>
              <div className="flex gap-2">
                <Input placeholder="1000.00" {...register('amount')} />
                <Select {...register('amountType')} className="w-28">
                  <option value="crypto">Crypto</option>
                  <option value="fiat">USD</option>
                </Select>
              </div>
              {errors.amount && <p className="text-xs text-red-500">{errors.amount.message}</p>}
            </div>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={getQuote} disabled={quoting}>
            {quoting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Quote…</> : 'Get Quote'}
          </Button>
        </form>

        {/* Quote */}
        {quote && (
          <div className="mt-4 p-4 rounded-lg bg-[#207679]/5 border border-[#207679]/20 space-y-2">
            <div className="text-sm font-semibold text-[#195a5c]">Quote</div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{direction === 'offramp' ? 'You send' : 'You pay'}</span>
              <span className="font-mono font-semibold">
                {direction === 'offramp'
                  ? `${quote.cryptoAmount.toLocaleString()} ${getValues('cryptoToken')}`
                  : `$${quote.fiatAmount.toLocaleString()}`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">{direction === 'offramp' ? 'You receive' : 'You receive'}</span>
              <span className="font-mono font-semibold text-green-700">
                {direction === 'offramp'
                  ? `$${quote.fiatAmount.toLocaleString()}`
                  : `${quote.cryptoAmount.toLocaleString()} ${getValues('cryptoToken')}`}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Rate</span>
              <span className="font-mono text-gray-700">${quote.exchangeRate.toFixed(4)} per token</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Fee</span>
              <span className="font-mono text-gray-700">${quote.feeAmount.toFixed(2)}</span>
            </div>
            <div className="text-xs text-gray-400">
              Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}
            </div>
            <Button className="w-full mt-2" onClick={executeRamp} disabled={executing}>
              {executing
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Executing…</>
                : `Execute ${direction === 'offramp' ? 'Off-ramp' : 'On-ramp'}`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
