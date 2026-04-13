'use client';
import { useState, useEffect } from 'react';
import { InlineSuccess } from '@/components/ui/inline-success';
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
import { Loader2, Send, CircleAlert } from 'lucide-react';
import { sanitizeErrorMessage } from '@/lib/utils';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { VANTOR_FEE_RATE } from '@/lib/billing/tiers';
import {
  getAvailableRails,
  calculateRailFee,
  type PaymentRail,
} from '@/lib/banking/rail-fees';
import type { BankAccount } from '@/types/database';

const RAIL_VALUES = ['ach_push', 'ach_same_day', 'wire', 'swift', 'sepa', 'spei', 'pix'] as const;

const schema = z.object({
  fromBankAccountId: z.string().min(1, 'Select a bank account'),
  toBankName: z.string().min(1, 'Enter bank name'),
  toAccountHolder: z.string().min(1, 'Enter account holder'),
  toAccountNumber: z.string().min(1, 'Enter account number'),
  toRoutingNumber: z.string().min(1, 'Enter routing number'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN']),
  paymentRail: z.enum(RAIL_VALUES),
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'USD', paymentRail: 'ach_push' },
  });

  const fromBankAccountId = watch('fromBankAccountId');
  const toBankName = watch('toBankName');
  const toAccountHolder = watch('toAccountHolder');
  const toAccountNumber = watch('toAccountNumber');
  const toRoutingNumber = watch('toRoutingNumber');
  const amount = watch('amount');
  const currency = watch('currency');
  const paymentRail = watch('paymentRail');
  const memo = watch('memo');

  const availableRails = getAvailableRails(currency ?? 'USD');
  const selectedRailSchedule = availableRails.find((r) => r.rail === paymentRail);

  // If the user changes currency and the currently-selected rail doesn't
  // support the new currency, snap to the first compatible rail.
  useEffect(() => {
    if (!availableRails.length) return;
    if (!availableRails.some((r) => r.rail === paymentRail)) {
      setValue('paymentRail', availableRails[0].rail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const railFee = amount && parseFloat(amount) > 0 && paymentRail
    ? calculateRailFee(paymentRail as PaymentRail, parseFloat(amount))
    : null;

  const isReady = !!(fromBankAccountId && toBankName && toAccountHolder && toAccountNumber && toRoutingNumber && amount && paymentRail);

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
        paymentRail: data.paymentRail,
        invoiceId: data.invoiceId || undefined,
        memo: data.memo || undefined,
      });
      toast({
        title: 'Payment sent',
        description: selectedRailSchedule
          ? `Settlement: ${selectedRailSchedule.settlementTime.toLowerCase()}.`
          : 'Settlement typically takes 2 business days.',
        variant: 'success',
      });
      reset();
      setSuccessMessage('Payment sent');
    } catch (err) {
      toast({ title: 'Payment failed', description: sanitizeErrorMessage((err as Error).message), variant: 'destructive' });
    }
  };

  return (
    <Card className="border-t-2 border-t-teal-500/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Send Payment
          <InfoTooltip content="Send funds from your bank account to another bank account." />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {successMessage && (
          <InlineSuccess message={successMessage} onDismiss={() => setSuccessMessage(null)} />
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Source */}
          <div className="space-y-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
            <div className="space-y-2">
              <Label>From Bank Account</Label>
              <Select {...register('fromBankAccountId')} aria-required="true">
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
              {errors.fromBankAccountId && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.fromBankAccountId.message}
                </p>
              )}
            </div>
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Destination */}
          <div className="space-y-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Destination</p>
          <div className="space-y-2">
            <Label>Bank Name</Label>
            <Input placeholder="Chase, Bank of America…" {...register('toBankName')} />
            {errors.toBankName && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.toBankName.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Account Holder</Label>
            <Input placeholder="Recipient name…" {...register('toAccountHolder')} />
            {errors.toAccountHolder && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.toAccountHolder.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Account Number</Label>
              <Input placeholder="123456789" {...register('toAccountNumber')} />
              {errors.toAccountNumber && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.toAccountNumber.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Routing Number</Label>
              <Input placeholder="021000021" {...register('toRoutingNumber')} />
              {errors.toRoutingNumber && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.toRoutingNumber.message}
                </p>
              )}
            </div>
          </div>
          </div>

          <div className="h-px bg-white/[0.06]" />

          {/* Payment Details */}
          <div className="space-y-4">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Payment Details</p>

          {/* Amount + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="1000.00" {...register('amount')} aria-required="true" />
              {errors.amount && (
                <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                  <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                  {errors.amount.message}
                </p>
              )}
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

          {/* Payment rail */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Payment Method
              <InfoTooltip content="The banking rail used to move funds. Different rails have different fees and settlement times." />
            </Label>
            <Select {...register('paymentRail')}>
              {availableRails.length === 0 ? (
                <option value="">No rails available for {currency}</option>
              ) : (
                availableRails.map((r) => (
                  <option key={r.rail} value={r.rail}>
                    {r.label} · {r.settlementTime}
                  </option>
                ))
              )}
            </Select>
            {availableRails.length === 0 && (
              <p className="text-xs text-amber-400">Select a different currency to see available payment methods.</p>
            )}
            {errors.paymentRail && (
              <p className="text-sm text-red-400 flex items-center gap-1.5" role="alert">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                {errors.paymentRail.message}
              </p>
            )}
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
            {memo && memo.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{memo.length}/2,000</p>
            )}
          </div>

          {amount && parseFloat(amount) > 0 && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2 text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-mono">
                  {parseFloat(amount).toFixed(2)} {currency}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Vantor fee (0.25%)</span>
                <span className="font-mono">
                  {(parseFloat(amount) * VANTOR_FEE_RATE).toFixed(2)} {currency}
                </span>
              </div>
              {railFee && selectedRailSchedule && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {selectedRailSchedule.label} fee
                  </span>
                  <span className="font-mono">
                    {railFee.total.toFixed(2)} {railFee.currency}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-white/[0.08] pt-2 mt-1">
                <span>Total fees</span>
                <span className="font-mono">
                  {(
                    parseFloat(amount) * VANTOR_FEE_RATE +
                    (railFee?.currency === currency ? railFee.total : 0)
                  ).toFixed(2)}{' '}
                  {currency}
                  {railFee && railFee.currency !== currency && (
                    <span className="text-muted-foreground"> + {railFee.total.toFixed(2)} {railFee.currency}</span>
                  )}
                </span>
              </div>
              <div className="text-xs text-muted-foreground pt-2 border-t border-white/[0.06] leading-relaxed">
                Both fees are deducted at payment time by our banking rail.
                {selectedRailSchedule && (
                  <> Expected settlement: <span className="font-medium">{selectedRailSchedule.settlementTime.toLowerCase()}</span>.</>
                )}
              </div>
            </div>
          )}
          </div>

          <Button type="submit" className="w-full btn-gradient" disabled={isSubmitting || !isReady}>
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
