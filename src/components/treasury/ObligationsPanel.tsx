'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useManualObligations, useCreateObligation, useDeleteObligation } from '@/hooks/useTreasury';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import type { Invoice, ManualObligation } from '@/types/database';

const obligationSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  description: z.string().optional(),
  amount_usd: z.number({ coerce: true }).positive('Must be positive'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  is_recurring: z.boolean().default(false),
  recurrence_days: z.number({ coerce: true }).int().positive().optional(),
});

type ObligationForm = z.infer<typeof obligationSchema>;

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatUsd(v: string | number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v));
}

function DueBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="destructive">Overdue</Badge>;
  if (days <= 3) return <Badge variant="destructive">{days}d</Badge>;
  if (days <= 7) return <Badge variant="warning">{days}d</Badge>;
  return <Badge variant="secondary">{days}d</Badge>;
}

export function ObligationsPanel() {
  const [tab, setTab] = useState<'manual' | 'erp'>('manual');
  const [showAdd, setShowAdd] = useState(false);
  const { toast } = useToast();
  const { data: session } = useSession();

  const { data: obligations, isLoading: loadingManual } = useManualObligations();
  const createObligation = useCreateObligation();
  const deleteObligation = useDeleteObligation();

  const { data: invoicesData, isLoading: loadingErp } = useQuery<Invoice[]>({
    queryKey: ['invoices-obligations', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/invoices?status=unpaid,overdue');
      if (!res.ok) throw new Error('Failed');
      const { data } = await res.json();
      return data ?? [];
    },
    enabled: !!session?.user?.id && tab === 'erp',
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ObligationForm>({
    resolver: zodResolver(obligationSchema),
    defaultValues: { is_recurring: false },
  });

  const isRecurring = watch('is_recurring');

  const onSubmit = async (values: ObligationForm) => {
    try {
      await createObligation.mutateAsync(values);
      toast({ title: 'Obligation added', variant: 'success' });
      reset();
      setShowAdd(false);
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteObligation.mutateAsync(id);
      toast({ title: 'Obligation removed', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <>
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Upcoming Obligations</CardTitle>
            {tab === 'manual' && (
              <Button size="sm" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            )}
          </div>
          <div className="flex gap-1 mt-2">
            {(['manual', 'erp'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  tab === t
                    ? 'bg-[#207679] text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {t === 'manual' ? 'Manual' : 'ERP Invoices'}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent className="overflow-auto max-h-96">
          {tab === 'manual' && (
            <>
              {loadingManual ? (
                <div className="text-sm text-muted-foreground py-4">Loading…</div>
              ) : !obligations?.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No manual obligations. Add payroll, rent, etc.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Label</th>
                      <th className="pb-2 font-medium text-right">Amount</th>
                      <th className="pb-2 font-medium text-center">Due</th>
                      <th className="pb-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {obligations.map((ob: ManualObligation) => (
                      <tr key={ob.id} className="py-2">
                        <td className="py-2 pr-2">
                          <div className="font-medium">{ob.label}</div>
                          {ob.description && (
                            <div className="text-xs text-muted-foreground">{ob.description}</div>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold">
                          {formatUsd(ob.amount_usd)}
                        </td>
                        <td className="py-2 text-center">
                          <DueBadge days={daysUntil(ob.due_date)} />
                        </td>
                        <td className="py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleDelete(ob.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {tab === 'erp' && (
            <>
              {loadingErp ? (
                <div className="text-sm text-muted-foreground py-4">Loading…</div>
              ) : !invoicesData?.length ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No unpaid or overdue ERP invoices in the system.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Invoice</th>
                      <th className="pb-2 font-medium text-right">Amount</th>
                      <th className="pb-2 font-medium text-center">Due</th>
                      <th className="pb-2 font-medium text-center">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoicesData.map((inv: Invoice) => (
                      <tr key={inv.id}>
                        <td className="py-2 pr-2">
                          <div className="font-medium">{inv.description || inv.invoice_number}</div>
                          <div className="text-xs text-muted-foreground">{inv.invoice_number}</div>
                        </td>
                        <td className="py-2 text-right tabular-nums font-semibold">
                          {formatUsd(inv.amount)}
                        </td>
                        <td className="py-2 text-center">
                          {inv.due_date ? (
                            <DueBadge days={daysUntil(inv.due_date)} />
                          ) : (
                            <Badge variant="secondary">No date</Badge>
                          )}
                        </td>
                        <td className="py-2 text-center">
                          <Badge variant="secondary" className="text-xs">ERP</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Add Obligation Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manual Obligation</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="ob-label">Label</Label>
              <Input
                id="ob-label"
                placeholder="Payroll, Rent, Vendor payment…"
                {...register('label')}
              />
              {errors.label && (
                <p className="text-xs text-red-500 mt-1">{errors.label.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="ob-desc">Description (optional)</Label>
              <Input id="ob-desc" placeholder="Additional notes" {...register('description')} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ob-amount">Amount (USD)</Label>
                <Input
                  id="ob-amount"
                  type="number"
                  step="0.01"
                  placeholder="50000"
                  {...register('amount_usd')}
                />
                {errors.amount_usd && (
                  <p className="text-xs text-red-500 mt-1">{errors.amount_usd.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="ob-date">Due Date</Label>
                <Input id="ob-date" type="date" {...register('due_date')} />
                {errors.due_date && (
                  <p className="text-xs text-red-500 mt-1">{errors.due_date.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ob-recurring"
                className="h-4 w-4"
                {...register('is_recurring')}
              />
              <Label htmlFor="ob-recurring" className="cursor-pointer">Recurring</Label>
            </div>

            {isRecurring && (
              <div>
                <Label htmlFor="ob-recur-days">Recurrence (days)</Label>
                <Input
                  id="ob-recur-days"
                  type="number"
                  placeholder="30"
                  {...register('recurrence_days')}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Add Obligation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
