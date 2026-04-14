'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { sanitizeErrorMessage } from '@/lib/utils';
import type { HardLimit, HardLimitType } from '@/lib/policy/types/hard-limit';
import { Gauge, Check } from 'lucide-react';

interface Props {
  versionId: string;
  limit?: HardLimit | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

type LimitMeta = {
  label: string;
  helper: string;
  /** Unit label shown in the trailing-icon position of the value input. */
  unit: string;
  /** Whether the scope.asset field is meaningful for this limit. */
  scopeAsset: boolean;
  /** Whether the scope.venue field is meaningful. */
  scopeVenue: boolean;
  /** Prefilled currency for the stored decimal. null = percentage/duration (no currency). */
  currency: 'USD' | null;
};

const TYPE_META: Record<HardLimitType, LimitMeta> = {
  min_cash_reserve_usd: {
    label: 'Minimum cash reserve',
    helper: 'Block any outflow that would leave cash reserves below this USD floor.',
    unit: 'USD',
    scopeAsset: false,
    scopeVenue: true,
    currency: 'USD',
  },
  max_single_asset_concentration_pct: {
    label: 'Max single-asset concentration',
    helper: 'Cap the share of the treasury held in any one asset.',
    unit: '%',
    scopeAsset: true,
    scopeVenue: false,
    currency: null,
  },
  max_daily_outflow_usd: {
    label: 'Max daily outflow',
    helper: 'Cap total outflow in any rolling 24-hour window.',
    unit: 'USD',
    scopeAsset: false,
    scopeVenue: false,
    currency: 'USD',
  },
  max_30day_outflow_usd: {
    label: 'Max 30-day outflow',
    helper: 'Cap total outflow in any rolling 30-day window.',
    unit: 'USD',
    scopeAsset: false,
    scopeVenue: false,
    currency: 'USD',
  },
  obligation_coverage_days: {
    label: 'Obligation coverage days',
    helper: 'Block outflows that would leave upcoming obligations uncovered within the window.',
    unit: 'days',
    scopeAsset: false,
    scopeVenue: false,
    currency: null,
  },
  max_native_exposure: {
    label: 'Max native exposure',
    helper: 'Cap native balance on a specific asset × venue pair.',
    unit: 'native',
    scopeAsset: true,
    scopeVenue: true,
    currency: null,
  },
};

const ASSET_OPTIONS = ['USD', 'USDC', 'USDT'] as const;

export function HardLimitDialog({ versionId, limit, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const editing = !!limit?.id;
  const [type, setType] = useState<HardLimitType>('max_daily_outflow_usd');
  const [name, setName] = useState('');
  const [value, setValue] = useState<string>('100000');
  const [scopeAsset, setScopeAsset] = useState<string>('USD');
  const [scopeVenue, setScopeVenue] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (limit) {
      setType(limit.limit_type);
      setName(limit.name);
      setValue(limit.limit_value);
      setScopeAsset(limit.scope?.asset ?? 'USD');
      setScopeVenue(limit.scope?.venue ?? '');
    } else {
      setType('max_daily_outflow_usd');
      setName('');
      setValue('100000');
      setScopeAsset('USD');
      setScopeVenue('');
    }
  }, [limit, open]);

  const meta = TYPE_META[type];

  async function save() {
    if (!name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(value)) {
      toast({ title: 'Value must be a non-negative decimal', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const scope: Record<string, string | string[]> = {};
      if (meta.scopeAsset && scopeAsset) scope.asset = scopeAsset;
      if (meta.scopeVenue && scopeVenue.trim()) scope.venue = scopeVenue.trim();

      const body: Record<string, unknown> = {
        ...(limit?.id ? { id: limit.id } : {}),
        limit_type: type,
        name: name.trim(),
        limit_value: value,
        scope,
      };
      if (meta.currency) body.limit_currency = meta.currency;

      const res = await fetch(`/api/policy/versions/${versionId}/hard-limits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Save failed (${res.status})`);
      }
      toast({ title: editing ? 'Limit updated' : 'Limit added', variant: 'success' });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Could not save limit',
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IconTile variant="failed" size="sm" emphasized>
              <Gauge />
            </IconTile>
            <DialogTitle className="m-0">
              {editing ? 'Edit hard limit' : 'New hard limit'}
            </DialogTitle>
          </div>
          <DialogDescription>
            Hard limits are the last safety rail. Breaching one blocks the movement regardless of any approval chain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Limit type" helper={meta.helper}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as HardLimitType)}
              disabled={editing}
            >
              {(Object.keys(TYPE_META) as HardLimitType[]).map((t) => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </Select>
          </Field>

          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily outflow cap"
              maxLength={200}
            />
          </Field>

          <Field label={`Limit value (${meta.unit})`} required>
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              leadingIcon={meta.currency === 'USD' ? <span className="text-muted-foreground text-sm">$</span> : undefined}
              trailingIcon={meta.currency !== 'USD' ? <span className="text-muted-foreground text-xs">{meta.unit}</span> : undefined}
            />
          </Field>

          {(meta.scopeAsset || meta.scopeVenue) && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                Scope
              </div>
              {meta.scopeAsset && (
                <Field label="Asset" helper="Limit applies only to this asset.">
                  <Select value={scopeAsset} onChange={(e) => setScopeAsset(e.target.value)}>
                    {ASSET_OPTIONS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {meta.scopeVenue && (
                <Field label="Venue" helper="Leave blank to apply across all venues.">
                  <Input
                    value={scopeVenue}
                    onChange={(e) => setScopeVenue(e.target.value)}
                    placeholder="e.g. ethereum, bank, aave_v3"
                  />
                </Field>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="default" onClick={save} disabled={submitting || !name.trim()}>
            {submitting ? 'Saving…' : (
              <>
                <Check className="w-4 h-4 mr-1.5" />
                {editing ? 'Save changes' : 'Add limit'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
