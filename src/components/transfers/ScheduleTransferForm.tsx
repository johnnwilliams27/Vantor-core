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
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Calendar } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { useInvoices } from '@/hooks/useInvoices';
import { formatCurrency } from '@/lib/utils';
import type { ErpConfiguration } from '@/types/database';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a wallet'),
  toAddress: z.string().min(10, 'Enter a valid address'),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
  erpConfigId: z.string().optional(),
  invoiceId: z.string().uuid().optional(),
});

type FormData = z.infer<typeof schema>;

export function ScheduleTransferForm() {
  const { data: wallets } = useWallets();
  const { data: unpaidInvoices } = useInvoices('unpaid');
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
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          chain: wallet.chain,
          scheduledFor: new Date(data.scheduledFor).toISOString(),
          invoiceId: data.invoiceId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Transfer scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
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
          Schedule Transfer
          <InfoTooltip content="Send stablecoins (USDC/USDT) from your wallet to another wallet address. Scheduled for a future date." />
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
              <DateTimePicker
                value={watch('scheduledFor') ?? ''}
                onChange={(v) => setValue('scheduledFor', v, { shouldValidate: true })}
              />
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

          {unpaidInvoices && unpaidInvoices.filter((inv) => ['USDC', 'USDT'].includes(inv.currency ?? inv.token ?? '')).length > 0 && (
            <div className="space-y-2">
              <Label>Apply to Invoice <span className="text-muted-foreground">(optional)</span></Label>
              <Select {...register('invoiceId')}>
                <option value="">None</option>
                {unpaidInvoices
                  .filter((inv) => ['USDC', 'USDT'].includes(inv.currency ?? inv.token ?? ''))
                  .map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} — {inv.vendor_name ?? 'Unknown'} ({formatCurrency(inv.amount)} {inv.currency ?? inv.token})
                    </option>
                  ))}
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Transfer reference…" {...register('memo')} />
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || exceeds || !selectedWalletId || !watch('toAddress') || !amount || !watch('scheduledFor')}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              'Schedule Transfer'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
