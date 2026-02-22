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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';
import type { ErpConfiguration } from '@/types/database';

const schema = z.object({
  fromWalletId: z.string().uuid('Select a wallet'),
  toAddress: z.string().min(10, 'Enter a valid address'),
  chain: z.enum(['ethereum', 'solana']),
  token: z.enum(['USDC', 'USDT', 'PYUSD']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  memo: z.string().optional(),
  erpConfigId: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function SendPaymentForm() {
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
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast({ title: 'Payment sent', description: `TX: ${json.data?.tx_hash?.slice(0, 12)}…`, variant: 'success' });
      reset();
      queryClient.invalidateQueries({ queryKey: ['payments-volume'] });
    } catch (err) {
      toast({ title: 'Payment failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Send Payment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>From Wallet</Label>
            <Select {...register('fromWalletId')}>
              <option value="">Select wallet…</option>
              {wallets?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label ?? `${w.chain} – ${w.address.slice(0, 10)}…`}
                </option>
              ))}
            </Select>
            {errors.fromWalletId && <p className="text-sm text-red-500">{errors.fromWalletId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Chain</Label>
              <Select {...register('chain')}>
                <option value="ethereum">Ethereum</option>
                <option value="solana">Solana</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Token</Label>
              <Select {...register('token')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
                <option value="PYUSD">PYUSD</option>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>To Address</Label>
            <Input placeholder="0x… or base58…" {...register('toAddress')} />
            {errors.toAddress && <p className="text-sm text-red-500">{errors.toAddress.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Amount</Label>
            <Input placeholder="100.00" {...register('amount')} />
            {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
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

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
            ) : (
              'Send Payment'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
