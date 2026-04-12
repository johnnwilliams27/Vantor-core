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
import { useWalletTokenBalance, useWalletTokenHoldings, formatWalletTokensLabel } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { Loader2, Calendar, CircleAlert, ArrowUpDown } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { useCreateScheduledOperation } from '@/hooks/useScheduledOperations';
import { sanitizeErrorMessage } from '@/lib/utils';

const schema = z.object({
  walletId: z.string().uuid('Select a wallet'),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
}).refine((d) => d.fromToken !== d.toToken, {
  message: 'From and to tokens must differ',
  path: ['toToken'],
});

type FormData = z.infer<typeof schema>;

export function ScheduleSwapForm() {
  const { data: wallets } = useWallets();
  const walletHoldings = useWalletTokenHoldings();
  const { toast } = useToast();
  const createOp = useCreateScheduledOperation();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fromToken: 'USDC', toToken: 'USDT' },
  });

  const selectedWalletId = watch('walletId');
  const fromToken = watch('fromToken');
  const toToken = watch('toToken');
  const amount = watch('amount');
  const memo = watch('memo');
  const selectedWallet = wallets?.find((w) => w.id === selectedWalletId);
  const balance = useWalletTokenBalance(selectedWalletId, fromToken);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const onSubmit = async (data: FormData) => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${data.fromToken} in this wallet.`, variant: 'destructive' });
      return;
    }
    const wallet = wallets?.find((w) => w.id === data.walletId);
    if (!wallet) return;
    try {
      await createOp.mutateAsync({
        type: 'swap',
        scheduledFor: new Date(data.scheduledFor).toISOString(),
        memo: data.memo,
        params: {
          walletId: data.walletId,
          chain: wallet.chain,
          fromToken: data.fromToken,
          toToken: data.toToken,
          amount: data.amount,
          walletAddress: wallet.address,
        },
      });
      toast({ title: 'Swap scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
      reset();
    } catch (err) {
      toast({ title: 'Error', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    }
  };

  return (
    <Card className="border-t-2 border-t-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule Swap
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">Auto-executes within 10bps of quoted rate. Approval required for larger deviations.</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Wallet</Label>
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
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.walletId.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div className="space-y-2">
              <Label>From Token</Label>
              <Select {...register('fromToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
            </div>
            <button
              type="button"
              onClick={() => {
                const from = getValues('fromToken');
                const to = getValues('toToken');
                setValue('fromToken', to);
                setValue('toToken', from);
              }}
              className="w-8 h-8 mb-0.5 rounded-full border border-white/10 bg-white/[0.03] flex items-center justify-center text-muted-foreground hover:text-white hover:border-white/20 transition-colors"
              aria-label="Swap token direction"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
            <div className="space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
              {errors.toToken && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.toToken.message}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="100.00" {...register('amount')} />
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
              <Label>Schedule For</Label>
              <DateTimePicker
                value={watch('scheduledFor') ?? ''}
                onChange={(v) => setValue('scheduledFor', v, { shouldValidate: true })}
                min={new Date().toISOString().slice(0, 16)}
              />
              {errors.scheduledFor && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.scheduledFor.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Swap reference…" {...register('memo')} />
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          <Button type="submit" variant="outline" className="w-full" disabled={createOp.isPending || exceeds || !selectedWalletId || !amount || !watch('scheduledFor')}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              'Schedule Swap'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
