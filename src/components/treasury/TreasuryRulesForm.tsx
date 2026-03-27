'use client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CardSpinner } from '@/components/ui/spinner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useTreasuryRules, useSaveTreasuryRule } from '@/hooks/useTreasury';
import { Settings2, AlertCircle } from 'lucide-react';

const ruleSchema = z.object({
  label: z.string().min(1).max(200),
  safety_buffer_multiplier: z.number({ coerce: true }).min(1).max(10),
  obligation_lookahead_days: z.number({ coerce: true }).int().min(1).max(365),
  target_stablecoin: z.string().min(1),
  target_chain: z.string().min(1),
  approval_threshold_usd: z.number({ coerce: true }).positive(),
});

type RuleForm = z.infer<typeof ruleSchema>;

const STABLECOINS = ['USDC', 'USDT'];
const CHAINS = ['ethereum', 'solana'];

export function TreasuryRulesForm() {
  const { data: rule, isLoading } = useTreasuryRules();
  const saveRule = useSaveTreasuryRule();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema),
    defaultValues: {
      label: 'Default Rule',
      safety_buffer_multiplier: 1.5,
      obligation_lookahead_days: 7,
      target_stablecoin: 'USDC',
      target_chain: 'ethereum',
      approval_threshold_usd: 100000,
    },
  });

  // Populate form when rule loads
  useEffect(() => {
    if (rule) {
      reset({
        label: rule.label,
        safety_buffer_multiplier: parseFloat(rule.safety_buffer_multiplier),
        obligation_lookahead_days: rule.obligation_lookahead_days,
        target_stablecoin: rule.target_stablecoin,
        target_chain: rule.target_chain,
        approval_threshold_usd: parseFloat(rule.approval_threshold_usd),
      });
    }
  }, [rule, reset]);

  const onSubmit = async (values: RuleForm) => {
    try {
      await saveRule.mutateAsync({ ...values, id: rule?.id });
      toast({ title: rule ? 'Rule updated' : 'Rule created', variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent><CardSpinner /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Settings2 className="h-4 w-4 text-gray-500" />
          Treasury Rules
        </CardTitle>
        {!rule && (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 rounded-md p-2 mt-1">
            <AlertCircle className="h-4 w-4 shrink-0" />
            No rule configured. Set one up to enable AI recommendations.
          </div>
        )}
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Label htmlFor="rule-label">Rule Label</Label>
            <Input id="rule-label" placeholder="Default Rule" {...register('label')} />
            {errors.label && <p className="text-xs text-red-500 mt-1">{errors.label.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rule-multiplier">Safety Buffer (×)</Label>
              <Input
                id="rule-multiplier"
                type="number"
                step="0.1"
                min="1"
                max="10"
                {...register('safety_buffer_multiplier')}
              />
              {errors.safety_buffer_multiplier && (
                <p className="text-xs text-red-500 mt-1">{errors.safety_buffer_multiplier.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="rule-lookahead">Lookahead (days)</Label>
              <Input
                id="rule-lookahead"
                type="number"
                min="1"
                max="365"
                {...register('obligation_lookahead_days')}
              />
              {errors.obligation_lookahead_days && (
                <p className="text-xs text-red-500 mt-1">{errors.obligation_lookahead_days.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="rule-threshold">Approval Threshold (USD)</Label>
            <Input
              id="rule-threshold"
              type="number"
              step="1000"
              placeholder="100000"
              {...register('approval_threshold_usd')}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Ramps above this amount require manual approval
            </p>
            {errors.approval_threshold_usd && (
              <p className="text-xs text-red-500 mt-1">{errors.approval_threshold_usd.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rule-token">Target Stablecoin</Label>
              <select
                id="rule-token"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                {...register('target_stablecoin')}
              >
                {STABLECOINS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="rule-chain">Target Chain</Label>
              <select
                id="rule-chain"
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                {...register('target_chain')}
              >
                {CHAINS.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting || (!isDirty && !!rule)}>
            {isSubmitting ? 'Saving…' : rule ? 'Update Rule' : 'Create Rule'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
