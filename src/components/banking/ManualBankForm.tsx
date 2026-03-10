'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';

const schema = z.object({
  institution_name: z.string().min(1, 'Institution name is required'),
  account_name: z.string().min(1, 'Account name is required'),
  account_type: z.enum(['checking', 'savings']),
  last4: z.string().length(4, 'Must be exactly 4 digits').regex(/^\d{4}$/).optional().or(z.literal('')),
  routing_number: z.string().optional(),
  currency: z.string().default('USD'),
});

type FormData = z.infer<typeof schema>;

interface ManualBankFormProps {
  onSuccess: () => void;
}

export function ManualBankForm({ onSuccess }: ManualBankFormProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { account_type: 'checking', currency: 'USD' },
  });

  const onSubmit = async (data: FormData) => {
    setSaving(true);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          last4: data.last4 || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Bank account added', variant: 'success' });
      reset();
      onSuccess();
    } catch (err) {
      toast({ title: 'Failed to add account', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Institution Name</Label>
          <Input placeholder="Chase, Bank of America…" {...register('institution_name')} />
          {errors.institution_name && <p className="text-xs text-red-500">{errors.institution_name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label>Account Name</Label>
          <Input placeholder="Checking, Business Account…" {...register('account_name')} />
          {errors.account_name && <p className="text-xs text-red-500">{errors.account_name.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Account Type</Label>
          <Select {...register('account_type')}>
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Last 4 Digits</Label>
          <Input placeholder="4321" maxLength={4} {...register('last4')} />
          {errors.last4 && <p className="text-xs text-red-500">{errors.last4.message}</p>}
        </div>
        <div className="space-y-2">
          <Label>Currency</Label>
          <Select {...register('currency')}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Routing Number <span className="text-gray-400 text-xs">(optional)</span></Label>
        <Input placeholder="021000021" {...register('routing_number')} />
      </div>

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Add Account'}
      </Button>
    </form>
  );
}
