'use client';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Calendar } from 'lucide-react';
import type { ErpConfiguration } from '@/types/database';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a wallet'),
  toAddress: z.string().min(10, 'Enter a valid address'),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
  erpConfigId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function SchedulePaymentForm() {
  const { data: wallets } = useWallets();
  const { data: erpConfigs } = useQuery<ErpConfiguration[]>({
    queryKey: ['erp-configs'],
    queryFn: async () => {
      const res = await fetch('/api/erp/connect');
      if (!res.ok) return [];
      const { data } = await res.json();
      return (data ?? []).filter((c: ErpConfiguration) => c.is_active);
    },
    staleTime: 60_000,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const selectedWalletId = watch('fromWalletId');
  const selectedToken = watch('token');
  const amount = watch('amount');
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);
  const balance = useWalletTokenBalance(selectedWalletId, selectedToken);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const onSubmit = async (data: FormData) => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${data.token} in this wallet.`, variant: 'destructive' });
      return;
    }
    const wallet = wallets?.find((w) => w.id === data.fromWalletId);
    if (!wallet) return;
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          chain: wallet.chain,
          scheduledFor: new Date(data.scheduledFor).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Payment scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
      reset();
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule Payment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>From Wallet</Label>
            <Select {...register('fromWalletId')}>
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
            {errors.fromWalletId && <p className="text-sm text-red-500">{errors.fromWalletId.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Token</Label>
            <Select {...register('token')}>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
              <option value="PYUSD">PYUSD</option>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>To Address</Label>
            <Input placeholder="0x… or base58…" {...register('toAddress')} />
            {errors.toAddress && <p className="text-sm text-red-500">{errors.toAddress.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="100.00" {...register('amount')} />
              <BalanceHint
                balance={balance}
                token={selectedToken ?? 'USDC'}
                currentAmount={amount}
                onMax={(max) => setValue('amount', max)}
              />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Schedule For</Label>
              <Input type="datetime-local" {...register('scheduledFor')} />
              {errors.scheduledFor && <p className="text-sm text-red-500">{errors.scheduledFor.message}</p>}
            </div>
          </div>

          {erpConfigs && erpConfigs.length > 0 && (
            <div className="space-y-2">
              <Label>ERP System <span className="text-gray-400">(optional)</span></Label>
              <Select {...register('erpConfigId')}>
                <option value="">None</option>
                {erpConfigs.map((cfg) => (
                  <option key={cfg.id} value={cfg.id}>
                    {cfg.label} ({cfg.provider.toUpperCase()})
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Payment reference…" {...register('memo')} />
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || exceeds}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              'Schedule Payment'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
