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
import { Loader2, Calendar } from 'lucide-react';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { useCreateScheduledOperation } from '@/hooks/useScheduledOperations';
import { InfoTooltip } from '@/components/ui/info-tooltip';

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
  const { toast } = useToast();
  const createOp = useCreateScheduledOperation();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { fromToken: 'USDC', toToken: 'USDT' },
  });

  const selectedWalletId = watch('walletId');
  const fromToken = watch('fromToken');
  const toToken = watch('toToken');
  const amount = watch('amount');
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
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule Swap
          <InfoTooltip content="Exchange one stablecoin for another on the same blockchain. Scheduled for a future date." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Wallet</Label>
            <Select {...register('walletId')}>
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
            {errors.walletId && <p className="text-sm text-red-500">{errors.walletId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Token</Label>
              <Select {...register('fromToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
              {errors.toToken && <p className="text-sm text-red-500">{errors.toToken.message}</p>}
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

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Swap reference…" {...register('memo')} />
          </div>

          <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
            Auto-executes within 10bps of quoted rate. If rate deviates further, you&apos;ll be asked to approve.
          </p>

          <Button type="submit" className="w-full" disabled={createOp.isPending || exceeds || !selectedWalletId || !amount || !watch('scheduledFor')}>
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
