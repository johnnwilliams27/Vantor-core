'use client';
import { useEffect } from 'react';
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

const CHAIN_LABELS: Record<string, string> = { ethereum: 'Ethereum', solana: 'Solana' };

const schema = z.object({
  fromWalletId: z.string().uuid('Select a source wallet'),
  toWalletId: z.string().uuid('Select a destination wallet'),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function ScheduleBridgeForm() {
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
    defaultValues: { token: 'USDC' },
  });

  const fromWalletId = watch('fromWalletId');
  const toWalletId = watch('toWalletId');
  const token = watch('token');
  const amount = watch('amount');

  const fromWallet = wallets?.find((w) => w.id === fromWalletId);
  const toWallet = wallets?.find((w) => w.id === toWalletId);
  const sameChain = fromWallet && toWallet && fromWallet.chain === toWallet.chain;

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

  const balance = useWalletTokenBalance(fromWalletId, token);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const onSubmit = async (data: FormData) => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', description: `You don't have enough ${data.token} in this wallet.`, variant: 'destructive' });
      return;
    }
    if (!fromWallet || !toWallet) return;
    try {
      await createOp.mutateAsync({
        type: 'bridge',
        scheduledFor: new Date(data.scheduledFor).toISOString(),
        memo: data.memo,
        params: {
          fromWalletId: data.fromWalletId,
          toWalletId: data.toWalletId,
          token: data.token,
          amount: data.amount,
          fromChain: fromWallet.chain,
          toChain: toWallet.chain,
          walletAddress: fromWallet.address,
        },
      });
      toast({ title: 'Bridge scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
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
          Schedule Bridge
          <InfoTooltip content="Move the same stablecoin across different blockchains. Scheduled for a future date." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Token</Label>
            <Select {...register('token')}>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Wallet</Label>
              <Select {...register('fromWalletId')}>
                <option value="">Select source…</option>
                {wallets?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain] ?? w.chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`}
                  </option>
                ))}
              </Select>
              {errors.fromWalletId && <p className="text-sm text-red-500">{errors.fromWalletId.message}</p>}
            </div>

            <div className="space-y-2">
              <Label>To Wallet</Label>
              <Select {...register('toWalletId')}>
                <option value="">Select destination…</option>
                {destWallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {`${w.label ? `${w.label} · ` : ''}${CHAIN_LABELS[w.chain] ?? w.chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})`}
                  </option>
                ))}
              </Select>
              {errors.toWalletId && <p className="text-sm text-red-500">{errors.toWalletId.message}</p>}
              {sameChain && <p className="text-sm text-red-500">Destination must be on a different chain.</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1,000.00" {...register('amount')} />
              <BalanceHint
                balance={balance}
                token={token ?? 'USDC'}
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
            <Input placeholder="Bridge reference…" {...register('memo')} />
          </div>

          <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
            Auto-executes within 25bps of quoted rate. If rate deviates further, you&apos;ll be asked to approve.
          </p>

          <Button type="submit" className="w-full" disabled={createOp.isPending || exceeds || !!sameChain || !fromWalletId || !toWalletId || !amount || !watch('scheduledFor')}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              'Schedule Bridge'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
