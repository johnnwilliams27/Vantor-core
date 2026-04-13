'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { cn, sanitizeErrorMessage } from '@/lib/utils';
import { RULE_TEMPLATES, type RuleTemplate, type TemplateField } from '@/lib/policy/templates';
import { Flame, ShieldOff, Users, Ban, Clock, Filter, TrendingDown, Sparkles, ArrowLeft, Check } from 'lucide-react';

const ICON_FOR_TEMPLATE: Record<string, React.ReactNode> = {
  large_amount_approval: <Flame />,
  hard_limit_block: <ShieldOff />,
  new_counterparty_approval: <Users />,
  sanctions_block: <Ban />,
  daily_outflow_cap: <Clock />,
  kind_specific_approval: <Filter />,
  forecast_coverage_block: <TrendingDown />,
  ai_initiated_approval: <Sparkles />,
};

interface Props {
  versionId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}

/**
 * Template-first rule creation flow. Two steps:
 *   1. Picker — grid of template cards, click to select
 *   2. Form — preloaded fields with live natural-language preview
 *
 * No modals-on-modals. Form replaces the picker in place.
 */
export function TemplatePicker({ versionId, open, onOpenChange, onCreated }: Props) {
  const [picked, setPicked] = useState<RuleTemplate | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  function reset() {
    setPicked(null);
    setRuleName('');
    setValues({});
  }

  function selectTemplate(t: RuleTemplate) {
    setPicked(t);
    setRuleName(t.title);
    const initial: Record<string, string | number> = {};
    for (const f of t.fields) initial[f.key] = f.defaultValue;
    setValues(initial);
  }

  async function createRule() {
    if (!picked) return;
    if (!ruleName.trim()) {
      toast({ title: 'Name required', description: 'Give the rule a human-readable name.', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const rule = picked.build({ name: ruleName.trim(), values });
      const res = await fetch(`/api/policy/versions/${versionId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Create failed (${res.status})`);
      }
      toast({ title: 'Rule added', variant: 'success' });
      onCreated();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast({
        title: 'Could not create rule',
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        {!picked ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a rule</DialogTitle>
              <DialogDescription>
                Pick a template. You can always edit the condition later.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
              {RULE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t)}
                  className={cn(
                    'text-left rounded-lg border border-white/[0.08] bg-card p-4',
                    'hover:border-teal-500/30 hover:bg-white/[0.02] transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <IconTile variant={t.iconVariant} size="md" emphasized>
                      {ICON_FOR_TEMPLATE[t.id] ?? <Flame />}
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.blurb}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <button
                  onClick={reset}
                  className="p-1 rounded-md hover:bg-white/[0.04] transition-colors text-muted-foreground hover:text-foreground"
                  aria-label="Back to templates"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <IconTile variant={picked.iconVariant} size="sm" emphasized>
                  {ICON_FOR_TEMPLATE[picked.id] ?? <Flame />}
                </IconTile>
                <DialogTitle className="m-0">{picked.title}</DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <Field label="Rule name" required>
                <Input
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. Large transfer approval"
                  maxLength={200}
                />
              </Field>

              {picked.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key] ?? f.defaultValue}
                  onChange={(v) => setValues({ ...values, [f.key]: v })}
                />
              ))}

              {/* Live natural-language preview */}
              <div className="rounded-lg border border-teal-500/20 bg-teal-500/[0.04] p-4">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-teal-400 mb-1">
                  This rule will
                </div>
                <p className="text-sm leading-relaxed">{picked.summary(values)}</p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={reset} disabled={submitting}>Back</Button>
              <Button variant="default" onClick={createRule} disabled={submitting || !ruleName.trim()}>
                {submitting ? 'Adding…' : (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    Add rule
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  const commonLabel = <Field label={field.label} helper={field.helper}>{null}</Field>;

  if (field.kind === 'role_min' || field.kind === 'movement_kind') {
    return (
      <Field label={field.label} helper={field.helper}>
        <Select
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>
    );
  }

  if (field.kind === 'amount') {
    return (
      <Field label={field.label} helper={field.helper}>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          leadingIcon={<span className="text-muted-foreground text-sm">$</span>}
        />
      </Field>
    );
  }

  if (field.kind === 'days') {
    return (
      <Field label={field.label} helper={field.helper}>
        <Input
          type="number"
          inputMode="numeric"
          step={1}
          min={1}
          max={365}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          trailingIcon={<span className="text-muted-foreground text-xs">days</span>}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} helper={field.helper}>
      <Input value={String(value)} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}
