'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { cn, sanitizeErrorMessage } from '@/lib/utils';
import type {
  PolicyRule,
  ApprovalChain,
} from '@/lib/policy/types/policy-version';
import type {
  Condition,
  AmountCompareNode,
  StringCompareNode,
  TimeCompareNode,
  SanctionsStatusNode,
  AmountAttribute,
  StringAttribute,
  TimeAttribute,
  SanctionsStatus,
  NumericOp,
  StringOp,
  TimeOp,
} from '@/lib/policy/types/ir';
import { Wrench, Plus, Trash2, Check } from 'lucide-react';

type LeafKind = 'amount_compare' | 'string_compare' | 'time_compare' | 'sanctions_status';
type RuleType = PolicyRule['rule_type'];
type Verdict = 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';

const RULE_TYPE_OPTIONS: Array<{ value: RuleType; label: string }> = [
  { value: 'approval_threshold', label: 'Approval threshold' },
  { value: 'counterparty',       label: 'Counterparty' },
  { value: 'time_window',        label: 'Time window' },
  { value: 'lookahead',          label: 'Lookahead' },
];

const VERDICT_OPTIONS: Array<{ value: Verdict; label: string; iconVariant: 'active' | 'pending' | 'failed' }> = [
  { value: 'allow_auto',        label: 'Allow automatically',  iconVariant: 'active'  },
  { value: 'require_approval',  label: 'Require approval',     iconVariant: 'pending' },
  { value: 'block',             label: 'Block',                iconVariant: 'failed'  },
];

const LEAF_LABELS: Record<LeafKind, string> = {
  amount_compare: 'Amount',
  string_compare: 'Attribute',
  time_compare:   'Time',
  sanctions_status: 'Sanctions',
};

const AMOUNT_ATTR_OPTIONS: Array<{ value: AmountAttribute; label: string }> = [
  { value: 'transfer.amount',        label: 'Movement amount' },
  { value: 'treasury.position',      label: 'Treasury position (pre)' },
  { value: 'treasury.post_position', label: 'Treasury position (post)' },
  { value: 'rolling_sum',            label: 'Rolling sum (pre-computed)' },
];

const STRING_ATTR_OPTIONS: Array<{ value: StringAttribute; label: string }> = [
  { value: 'transfer.counterparty_id',     label: 'Counterparty ID' },
  { value: 'transfer.purpose_code',        label: 'Purpose code' },
  { value: 'transfer.initiator_type',      label: 'Initiator type' },
  { value: 'transfer.rail',                label: 'Rail' },
  { value: 'transfer.source_venue',        label: 'Source venue' },
  { value: 'transfer.destination_venue',   label: 'Destination venue' },
];

const TIME_ATTR_OPTIONS: Array<{ value: TimeAttribute; label: string; numeric: boolean }> = [
  { value: 'now.day_of_week',                   label: 'Day of week (0 Sun – 6 Sat)',          numeric: true },
  { value: 'now.hour_local',                    label: 'Hour of day (0–23, local)',            numeric: true },
  { value: 'now.is_business_hours',             label: 'Business hours (true/false)',          numeric: false },
  { value: 'time_since_last_to_counterparty',   label: 'Time since last to counterparty (ms)', numeric: true },
  { value: 'time_since_last_by_initiator',      label: 'Time since last by initiator (ms)',    numeric: true },
];

const SANCTIONS_STATUSES: Array<{ value: SanctionsStatus; label: string }> = [
  { value: 'clear',         label: 'Clear' },
  { value: 'sanctioned',    label: 'Sanctioned' },
  { value: 'partial_match', label: 'Partial match' },
  { value: 'unscreened',    label: 'Unscreened' },
];

// ─── Top-level props ──────────────────────────────────────────────────

interface Props {
  versionId: string;
  rule?: PolicyRule | null;
  chains?: ApprovalChain[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

// ─── Form state ───────────────────────────────────────────────────────

type LeafState =
  | { kind: 'amount_compare'; attr: AmountAttribute; op: NumericOp; amount: string; currency: 'USD' | 'USDC' | 'USDT' }
  | { kind: 'string_compare'; attr: StringAttribute; op: StringOp; value: string }
  | { kind: 'time_compare'; attr: TimeAttribute; op: TimeOp; value: string }
  | { kind: 'sanctions_status'; op: 'in' | 'not_in'; values: SanctionsStatus[] };

function newLeaf(kind: LeafKind): LeafState {
  switch (kind) {
    case 'amount_compare':
      return { kind, attr: 'transfer.amount', op: '>=', amount: '50000', currency: 'USD' };
    case 'string_compare':
      return { kind, attr: 'transfer.initiator_type', op: '==', value: 'ai_recommendation' };
    case 'time_compare':
      return { kind, attr: 'now.is_business_hours', op: '==', value: 'true' };
    case 'sanctions_status':
      return { kind, op: 'in', values: ['sanctioned'] };
  }
}

function leafToCondition(l: LeafState): Condition {
  switch (l.kind) {
    case 'amount_compare': {
      const node: AmountCompareNode = {
        kind: 'amount_compare',
        attr: l.attr,
        op: l.op,
        value: { amount: l.amount, currency: l.currency },
      };
      return node;
    }
    case 'string_compare': {
      const node: StringCompareNode = {
        kind: 'string_compare',
        attr: l.attr,
        op: l.op,
        value: l.op === 'in' || l.op === 'not_in'
          ? l.value.split(',').map((s) => s.trim()).filter(Boolean)
          : l.value,
      };
      return node;
    }
    case 'time_compare': {
      const meta = TIME_ATTR_OPTIONS.find((o) => o.value === l.attr);
      let v: number | string | boolean = l.value;
      if (meta?.numeric) {
        const n = Number(l.value);
        v = Number.isFinite(n) ? n : 0;
      } else if (l.value === 'true' || l.value === 'false') {
        v = l.value === 'true';
      }
      const node: TimeCompareNode = { kind: 'time_compare', attr: l.attr, op: l.op, value: v };
      return node;
    }
    case 'sanctions_status': {
      const node: SanctionsStatusNode = { kind: 'sanctions_status', op: l.op, values: l.values };
      return node;
    }
  }
}

function conditionToLeaf(c: Condition): LeafState | null {
  switch (c.kind) {
    case 'amount_compare':
      return {
        kind: 'amount_compare',
        attr: c.attr,
        op: c.op,
        amount: c.value?.amount ?? '0',
        currency: (c.value?.currency as 'USD' | 'USDC' | 'USDT') ?? 'USD',
      };
    case 'string_compare':
      return {
        kind: 'string_compare',
        attr: c.attr,
        op: c.op,
        value: Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? ''),
      };
    case 'time_compare':
      return {
        kind: 'time_compare',
        attr: c.attr,
        op: c.op,
        value: String(c.value),
      };
    case 'sanctions_status':
      return { kind: 'sanctions_status', op: c.op, values: c.values };
    default:
      return null;
  }
}

/** Flatten an AND tree into a list of leaf conditions we can edit. Unsupported
 *  compositions (OR/NOT/deeply nested/aggregate/forecast) are surfaced in an
 *  "advanced" flag the caller renders as a read-only JSON editor warning. */
function decomposeCondition(c: Condition | undefined): { leaves: LeafState[]; hasAdvanced: boolean } {
  if (!c) return { leaves: [], hasAdvanced: false };
  const out: LeafState[] = [];
  let hasAdvanced = false;

  const visit = (n: Condition) => {
    if (n.kind === 'and') {
      n.children.forEach(visit);
      return;
    }
    const leaf = conditionToLeaf(n);
    if (leaf) out.push(leaf);
    else hasAdvanced = true;
  };
  visit(c);
  return { leaves: out, hasAdvanced };
}

// ─── Natural-language preview ────────────────────────────────────────

function describeLeaf(l: LeafState): string {
  switch (l.kind) {
    case 'amount_compare': {
      const attrLabel =
        l.attr === 'transfer.amount' ? 'the movement amount'
        : l.attr === 'treasury.position' ? 'the pre-transfer treasury position'
        : l.attr === 'treasury.post_position' ? 'the post-transfer treasury position'
        : 'the pre-computed rolling sum';
      const amt = Number(l.amount).toLocaleString('en-US', { style: 'currency', currency: l.currency === 'USD' ? 'USD' : 'USD' });
      return `${attrLabel} ${l.op} ${amt}`;
    }
    case 'string_compare': {
      const attrLabel = STRING_ATTR_OPTIONS.find((o) => o.value === l.attr)?.label ?? l.attr;
      const opLabel = l.op === '==' ? 'is' : l.op === '!=' ? 'is not' : l.op === 'in' ? 'is one of' : 'is none of';
      return `${attrLabel.toLowerCase()} ${opLabel} "${l.value}"`;
    }
    case 'time_compare': {
      const attrLabel = TIME_ATTR_OPTIONS.find((o) => o.value === l.attr)?.label ?? l.attr;
      return `${attrLabel} ${l.op} ${l.value}`;
    }
    case 'sanctions_status':
      return `sanctions status ${l.op === 'in' ? 'is one of' : 'is not one of'} ${l.values.join(', ')}`;
  }
}

function describeRule(verdict: Verdict, leaves: LeafState[]): string {
  const prefix =
    verdict === 'block' || verdict === 'block_hard_limit' ? 'Block'
    : verdict === 'require_approval' ? 'Require approval for'
    : 'Allow';
  if (leaves.length === 0) return `${prefix} any movement (no conditions — always matches).`;
  if (leaves.length === 1) return `${prefix} movements where ${describeLeaf(leaves[0])}.`;
  const parts = leaves.map(describeLeaf);
  const lastTwo = parts.slice(-2).join(', and ');
  const head = parts.slice(0, -2);
  return `${prefix} movements where ${[...head, lastTwo].join(', ')}.`;
}

// ─── Component ───────────────────────────────────────────────────────

export function RuleBuilderDialog({ versionId, rule, chains, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const editing = !!rule?.id;

  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('approval_threshold');
  const [verdict, setVerdict] = useState<Verdict>('require_approval');
  const [priority, setPriority] = useState(100);
  const [rationale, setRationale] = useState('');
  const [chainId, setChainId] = useState<string>('');
  const [leaves, setLeaves] = useState<LeafState[]>([newLeaf('amount_compare')]);
  const [hasAdvanced, setHasAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setRuleType(rule.rule_type);
      setVerdict(rule.verdict as Verdict);
      setPriority(rule.priority);
      setRationale(rule.rationale ?? '');
      setChainId((rule as { verdict_chain_id?: string }).verdict_chain_id ?? '');
      const { leaves: ls, hasAdvanced } = decomposeCondition(rule.condition);
      setLeaves(ls.length > 0 ? ls : [newLeaf('amount_compare')]);
      setHasAdvanced(hasAdvanced);
    } else {
      setName('');
      setRuleType('approval_threshold');
      setVerdict('require_approval');
      setPriority(100);
      setRationale('');
      setChainId('');
      setLeaves([newLeaf('amount_compare')]);
      setHasAdvanced(false);
    }
  }, [rule, open]);

  const summary = useMemo(() => describeRule(verdict, leaves), [verdict, leaves]);

  const addLeaf = (kind: LeafKind) => setLeaves((prev) => [...prev, newLeaf(kind)]);
  const removeLeaf = (i: number) => setLeaves((prev) => prev.filter((_, idx) => idx !== i));
  const updateLeaf = (i: number, next: LeafState) => setLeaves((prev) => prev.map((l, idx) => (idx === i ? next : l)));

  async function save() {
    if (!name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    if (leaves.length === 0 && !hasAdvanced) {
      toast({ title: 'At least one condition required', variant: 'destructive' });
      return;
    }

    const condition: Condition =
      leaves.length === 1
        ? leafToCondition(leaves[0])
        : { kind: 'and', children: leaves.map(leafToCondition) };

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        ...(rule?.id ? { id: rule.id } : {}),
        rule_type: ruleType,
        name: name.trim(),
        rationale: rationale.trim() || 'Authored via rule builder.',
        condition,
        verdict,
        priority,
      };
      if (chainId) body.verdict_chain_id = chainId;

      const res = await fetch(`/api/policy/versions/${versionId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Save failed (${res.status})`);
      }
      toast({ title: editing ? 'Rule updated' : 'Rule added', variant: 'success' });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Could not save rule',
        description: sanitizeErrorMessage((err as Error).message),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IconTile variant="special" size="sm" emphasized>
              <Wrench />
            </IconTile>
            <DialogTitle className="m-0">
              {editing ? 'Edit rule' : 'Custom rule'}
            </DialogTitle>
          </div>
          <DialogDescription>
            Compose conditions against movement attributes, treasury state, time, and sanctions.
            Conditions join as AND — a movement must satisfy all of them to trigger the verdict.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto pr-1 -mr-1 flex-1 min-h-0">
          {hasAdvanced && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 text-xs">
              <div className="font-semibold text-amber-400 mb-1">Advanced condition detected</div>
              This rule's condition uses OR / NOT / aggregate_window / forecast_query nodes that the
              visual builder doesn't yet support. Editing here will collapse those nodes — save only
              if you intend to replace them. Full expressiveness comes in a follow-up.
            </div>
          )}

          {/* Top-level fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Rule name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Large wire to new vendor"
                maxLength={200}
              />
            </Field>
            <Field label="Rule type" helper="Groups related rules; drives UI categorization.">
              <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as RuleType)}>
                {RULE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Verdict" helper="What happens when the condition matches.">
              <Select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>
                {VERDICT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" helper="Lower = higher priority when multiple rules match.">
              <Input
                type="number"
                min={0}
                step={1}
                value={String(priority)}
                onChange={(e) => setPriority(Math.max(0, Number(e.target.value) || 0))}
              />
            </Field>
          </div>

          {verdict === 'require_approval' && chains && chains.length > 0 && (
            <Field label="Approval chain" helper="Which sign-off ladder routes this rule's held movements.">
              <Select value={chainId} onChange={(e) => setChainId(e.target.value)}>
                <option value="">Default (system-selected)</option>
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Rationale" helper="Why does this rule exist? Shown in audit + evaluation traces.">
            <Input
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="e.g. Finance team agreed to dual-control on > $50k transfers."
              maxLength={500}
            />
          </Field>

          {/* Condition builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-semibold text-foreground">Conditions</div>
                <div className="text-[11px] text-muted-foreground">All must match (AND)</div>
              </div>
              <div className="flex items-center gap-1">
                {(Object.keys(LEAF_LABELS) as LeafKind[]).map((k) => (
                  <Button key={k} variant="outline" size="sm" onClick={() => addLeaf(k)}>
                    <Plus className="w-3 h-3 mr-1" />
                    {LEAF_LABELS[k]}
                  </Button>
                ))}
              </div>
            </div>

            {leaves.length === 0 ? (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-6 text-center text-xs text-muted-foreground">
                No conditions — add one above. A rule with zero conditions always matches.
              </div>
            ) : (
              <div className="space-y-2">
                {leaves.map((l, i) => (
                  <LeafEditor
                    key={i}
                    leaf={l}
                    index={i}
                    onChange={(next) => updateLeaf(i, next)}
                    onRemove={() => removeLeaf(i)}
                    showAnd={i > 0}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="rounded-lg border border-teal-500/20 bg-teal-500/[0.04] p-4">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-teal-400 mb-1">
              This rule will
            </div>
            <p className="text-sm leading-relaxed">{summary}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="default" onClick={save} disabled={submitting || !name.trim()}>
            {submitting ? 'Saving…' : (
              <>
                <Check className="w-4 h-4 mr-1.5" />
                {editing ? 'Save changes' : 'Add rule'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Leaf editor ──────────────────────────────────────────────────

function LeafEditor({
  leaf,
  index,
  onChange,
  onRemove,
  showAnd,
}: {
  leaf: LeafState;
  index: number;
  onChange: (l: LeafState) => void;
  onRemove: () => void;
  showAnd: boolean;
}) {
  return (
    <div>
      {showAnd && (
        <div className="flex items-center gap-2 py-1">
          <div className="flex-1 border-t border-white/[0.06]" />
          <Badge variant="info-blue" size="xs" className="font-mono">AND</Badge>
          <div className="flex-1 border-t border-white/[0.06]" />
        </div>
      )}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="special" size="xs" className="font-mono">
            {LEAF_LABELS[leaf.kind]}
          </Badge>
          <button
            onClick={onRemove}
            className="p-1 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
            aria-label={`Remove condition ${index + 1}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {leaf.kind === 'amount_compare' && <AmountEditor leaf={leaf} onChange={onChange} />}
        {leaf.kind === 'string_compare' && <StringEditor leaf={leaf} onChange={onChange} />}
        {leaf.kind === 'time_compare' && <TimeEditor leaf={leaf} onChange={onChange} />}
        {leaf.kind === 'sanctions_status' && <SanctionsEditor leaf={leaf} onChange={onChange} />}
      </div>
    </div>
  );
}

function AmountEditor({ leaf, onChange }: {
  leaf: Extract<LeafState, { kind: 'amount_compare' }>;
  onChange: (l: LeafState) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <div className="col-span-2">
        <Select
          value={leaf.attr}
          onChange={(e) => onChange({ ...leaf, attr: e.target.value as AmountAttribute })}
        >
          {AMOUNT_ATTR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>
      <Select
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as NumericOp })}
      >
        {['>', '>=', '<', '<=', '==', '!='].map((op) => <option key={op} value={op}>{op}</option>)}
      </Select>
      <div className="grid grid-cols-[1fr_64px] gap-1">
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          min={0}
          value={leaf.amount}
          onChange={(e) => onChange({ ...leaf, amount: e.target.value })}
          leadingIcon={<span className="text-muted-foreground text-xs">$</span>}
        />
        <Select
          value={leaf.currency}
          onChange={(e) => onChange({ ...leaf, currency: e.target.value as 'USD' | 'USDC' | 'USDT' })}
        >
          <option value="USD">USD</option>
          <option value="USDC">USDC</option>
          <option value="USDT">USDT</option>
        </Select>
      </div>
    </div>
  );
}

function StringEditor({ leaf, onChange }: {
  leaf: Extract<LeafState, { kind: 'string_compare' }>;
  onChange: (l: LeafState) => void;
}) {
  const multi = leaf.op === 'in' || leaf.op === 'not_in';
  return (
    <div className="grid grid-cols-[1.5fr_1fr_2fr] gap-2">
      <Select
        value={leaf.attr}
        onChange={(e) => onChange({ ...leaf, attr: e.target.value as StringAttribute })}
      >
        {STRING_ATTR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Select
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as StringOp })}
      >
        <option value="==">is</option>
        <option value="!=">is not</option>
        <option value="in">is one of</option>
        <option value="not_in">is none of</option>
      </Select>
      <Input
        value={leaf.value}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        placeholder={multi ? 'comma-separated' : 'value'}
        className="font-mono text-xs"
      />
    </div>
  );
}

function TimeEditor({ leaf, onChange }: {
  leaf: Extract<LeafState, { kind: 'time_compare' }>;
  onChange: (l: LeafState) => void;
}) {
  return (
    <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2">
      <Select
        value={leaf.attr}
        onChange={(e) => onChange({ ...leaf, attr: e.target.value as TimeAttribute })}
      >
        {TIME_ATTR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <Select
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as TimeOp })}
      >
        {['==', '!=', '>', '>=', '<', '<=', 'in', 'not_in'].map((op) => <option key={op} value={op}>{op}</option>)}
      </Select>
      <Input
        value={leaf.value}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
        placeholder="value"
        className="font-mono text-xs"
      />
    </div>
  );
}

function SanctionsEditor({ leaf, onChange }: {
  leaf: Extract<LeafState, { kind: 'sanctions_status' }>;
  onChange: (l: LeafState) => void;
}) {
  function toggleValue(v: SanctionsStatus) {
    const next = leaf.values.includes(v) ? leaf.values.filter((x) => x !== v) : [...leaf.values, v];
    onChange({ ...leaf, values: next });
  }
  return (
    <div className="space-y-2">
      <Select
        value={leaf.op}
        onChange={(e) => onChange({ ...leaf, op: e.target.value as 'in' | 'not_in' })}
      >
        <option value="in">is one of</option>
        <option value="not_in">is none of</option>
      </Select>
      <div className="flex flex-wrap gap-1.5">
        {SANCTIONS_STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => toggleValue(s.value)}
            className={cn(
              'px-2.5 py-1 rounded-md border text-xs transition-colors',
              leaf.values.includes(s.value)
                ? 'border-purple-500/40 bg-purple-500/10 text-purple-400'
                : 'border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:border-white/[0.14]',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
