'use client';
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
import { Loader2, Calendar } from 'lucide-react';
import { useCreateScheduledOperation } from '@/hooks/useScheduledOperations';
import type { BankAccount } from '@/types/database';

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data;
}

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  bankAccountId: z.string().uuid('Select a bank account'),
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

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: 'offramp',
      cryptoToken: 'USDC',
      fiatCurrency: 'USD',
    },
  });

  const direction = watch('direction');

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
        },
      });
      toast({ title: 'Ramp scheduled', description: `Scheduled for ${data.scheduledFor}`, variant: 'success' });
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
          Schedule Ramp
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Direction</Label>
            <Select {...register('direction')}>
              <option value="offramp">Off-ramp (Crypto → Fiat)</option>
              <option value="onramp">On-ramp (Fiat → Crypto)</option>
            </Select>
            {errors.direction && <p className="text-sm text-red-500">{errors.direction.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Crypto Token</Label>
              <Select {...register('cryptoToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fiat Currency</Label>
              <Select {...register('fiatCurrency')}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Crypto Amount</Label>
            <Input placeholder="1000.00" {...register('amount')} />
            {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Bank Account</Label>
            <Select {...register('bankAccountId')}>
              <option value="">Select account…</option>
              {bankAccounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {`${a.nickname ? `${a.nickname} – ` : ''}${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`}
                </option>
              ))}
            </Select>
            {errors.bankAccountId && <p className="text-sm text-red-500">{errors.bankAccountId.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Schedule For</Label>
            <Input type="datetime-local" {...register('scheduledFor')} />
            {errors.scheduledFor && <p className="text-sm text-red-500">{errors.scheduledFor.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Ramp reference…" {...register('memo')} />
          </div>

          <p className="text-xs text-muted-foreground rounded-md bg-muted/50 p-3">
            Auto-executes within 50bps of quoted rate. If rate deviates further, you&apos;ll be asked to approve.
          </p>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              `Schedule ${direction === 'offramp' ? 'Off-ramp' : 'On-ramp'}`
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
