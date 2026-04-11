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
import { useCreateFiatPayment } from '@/hooks/useFiatPayments';
import { useInvoices } from '@/hooks/useInvoices';
import { Loader2, Send } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { VANTOR_FEE_RATE } from '@/lib/billing/tiers';
import type { BankAccount } from '@/types/database';

const schema = z.object({
  fromBankAccountId: z.string().min(1, 'Select a bank account'),
  toBankName: z.string().min(1, 'Enter bank name'),
  toAccountHolder: z.string().min(1, 'Enter account holder'),
  toAccountNumber: z.string().min(1, 'Enter account number'),
  toRoutingNumber: z.string().min(1, 'Enter routing number'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN']),
  invoiceId: z.string().optional(),
  memo: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

async function fetchBankAccounts(): Promise<BankAccount[]> {
  const res = await fetch('/api/bank-accounts');
  const json = await res.json();
  if (!res.ok) throw new Error(json.error);
  return json.data ?? [];
}

export function SendPaymentForm() {
  const { toast } = useToast();
  const { data: bankAccounts } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: fetchBankAccounts,
  });
  const { data: invoices } = useInvoices('unpaid');
  const createPayment = useCreateFiatPayment();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'USD' },
  });

  const fromBankAccountId = watch('fromBankAccountId');
  const toBankName = watch('toBankName');
  const toAccountHolder = watch('toAccountHolder');
  const toAccountNumber = watch('toAccountNumber');
  const toRoutingNumber = watch('toRoutingNumber');
  const amount = watch('amount');

  const isReady = !!(fromBankAccountId && toBankName && toAccountHolder && toAccountNumber && toRoutingNumber && amount);

  const onSubmit = async (data: FormData) => {
    try {
      await createPayment.mutateAsync({
        fromBankAccountId: data.fromBankAccountId,
        toBankName: data.toBankName,
        toAccountNumber: data.toAccountNumber,
        toRoutingNumber: data.toRoutingNumber,
        toAccountHolder: data.toAccountHolder,
        amount: data.amount,
        currency: data.currency,
        invoiceId: data.invoiceId || undefined,
        memo: data.memo || undefined,
      });
      toast({
        title: 'Payment sent',
        description: 'Settlement typically takes 2 business days.',
        variant: 'success',
      });
      reset();
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
          <InfoTooltip content="Send fiat currency from your bank account to another bank account." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* From bank account */}
          <div className="space-y-2">
            <Label>From Bank Account</Label>
            <Select {...register('fromBankAccountId')}>
              <option value="">Select account…</option>
              {bankAccounts?.map((a) => {
                const base = a.nickname
                  ? `${a.nickname} – ${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`
                  : `${a.institution_name}${a.last4 ? ` ****${a.last4}` : ''}`;
                const balance =
                  a.current_balance != null
                    ? new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: a.balance_currency || a.currency || 'USD',
                        maximumFractionDigits: 2,
                      }).format(parseFloat(a.current_balance))
                    : null;
                return (
                  <option key={a.id} value={a.id}>
                    {base}
                    {balance ? ` · ${balance}` : ''}
                  </option>
                );
              })}
            </Select>
            {errors.fromBankAccountId && <p className="text-sm text-red-500">{errors.fromBankAccountId.message}</p>}
          </div>

          {/* Destination fields */}
          <div className="space-y-2">
            <Label>Bank Name</Label>
            <Input placeholder="Chase, Bank of America…" {...register('toBankName')} />
            {errors.toBankName && <p className="text-sm text-red-500">{errors.toBankName.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Account Holder</Label>
            <Input placeholder="Recipient name…" {...register('toAccountHolder')} />
            {errors.toAccountHolder && <p className="text-sm text-red-500">{errors.toAccountHolder.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Account Number</Label>
              <Input placeholder="123456789" {...register('toAccountNumber')} />
              {errors.toAccountNumber && <p className="text-sm text-red-500">{errors.toAccountNumber.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Routing Number</Label>
              <Input placeholder="021000021" {...register('toRoutingNumber')} />
              {errors.toRoutingNumber && <p className="text-sm text-red-500">{errors.toRoutingNumber.message}</p>}
            </div>
          </div>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1000.00" {...register('amount')} />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select {...register('currency')}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="BRL">BRL</option>
                <option value="MXN">MXN</option>
              </Select>
            </div>
          </div>

          {/* Invoice */}
          <div className="space-y-2">
            <Label>Invoice <span className="text-muted-foreground">(optional)</span></Label>
            <Select {...register('invoiceId')}>
              <option value="">None</option>
              {invoices?.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number}
                </option>
              ))}
            </Select>
          </div>

          {/* Memo */}
          <div className="space-y-2">
            <Label>Memo <span className="text-muted-foreground">(optional)</span></Label>
            <Input placeholder="Payment reference…" {...register('memo')} />
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono">{parseFloat(amount).toFixed(2)} {watch('currency')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vantor fee (0.25%)</span>
                <span className="font-mono">
                  {(parseFloat(amount) * VANTOR_FEE_RATE).toFixed(2)} {watch('currency')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rail fee</span>
                <span className="font-mono text-muted-foreground">Varies — applied by bank</span>
              </div>
              <div className="text-xs text-muted-foreground pt-1.5 border-t border-border/50 leading-relaxed">
                The 0.25% Vantor fee is deducted at payment time by our banking rail
                (not billed monthly). Your bank may also apply rail fees — typically
                free for ACH, ~$25 for domestic wires, and 0.1–0.5% for SWIFT/international.
              </div>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting || !isReady}>
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
