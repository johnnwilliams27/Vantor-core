'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { IconTile } from '@/components/ui/icon-tile';
import { useToast } from '@/components/ui/toast';
import { cn, sanitizeErrorMessage } from '@/lib/utils';
import { APPROVER_ROLES, type ApproverRole } from '@/lib/auth/roles';
import type { ApprovalChain } from '@/lib/policy/types/policy-version';
import { Users, Plus, Trash2, ArrowDown, Check } from 'lucide-react';

interface Slot {
  slot_index: number;
  minimum_role: ApproverRole;
}

interface Props {
  versionId: string;
  /** Existing chain to edit, or null/undefined for a new chain. */
  chain?: ApprovalChain | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}

const ROLE_LABELS: Record<ApproverRole, string> = {
  accountant: 'Accountant',
  treasury_manager: 'Treasury manager',
  executive: 'Executive',
};

/**
 * Ordered approval chain authoring. A chain is N named slots, each requiring
 * a minimum role. Rules reference a chain by id via verdict_chain_id; at
 * approval time, the workflow service assigns approvers top-to-bottom and
 * waits for all slots to fill.
 *
 * Design notes:
 *   - Slots render as a stacked list with ↑↓ swap buttons and delete.
 *     Drag-reorder is deferred — button-based reorder is keyboard-accessible
 *     and trivially testable; drag UX would need a library we don't use yet.
 *   - The slot_index is recomputed on submit so gaps/duplicates from client
 *     edits can't reach the server.
 */
export function ChainDesignerDialog({ versionId, chain, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const editing = !!chain?.id;
  const [name, setName] = useState('');
  const [slots, setSlots] = useState<Slot[]>([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
  const [priority, setPriority] = useState<number>(100);
  const [expirationHours, setExpirationHours] = useState<number>(24);
  const [submitting, setSubmitting] = useState(false);

  // Reseed form whenever we open or switch chain
  useEffect(() => {
    if (!open) return;
    if (chain) {
      setName(chain.name);
      setSlots(
        (chain.slots ?? []).map((s, i) => ({
          slot_index: i,
          minimum_role: (s.minimum_role as ApproverRole) ?? 'treasury_manager',
        })),
      );
      setPriority(chain.priority ?? 100);
      setExpirationHours(chain.expiration_hours ?? 24);
    } else {
      setName('');
      setSlots([{ slot_index: 0, minimum_role: 'treasury_manager' }]);
      setPriority(100);
      setExpirationHours(24);
    }
  }, [chain, open]);

  function addSlot() {
    setSlots((prev) => [
      ...prev,
      { slot_index: prev.length, minimum_role: 'treasury_manager' },
    ]);
  }

  function removeSlot(i: number) {
    if (slots.length <= 1) return;
    setSlots((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, slot_index: idx })));
  }

  function moveSlot(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slots.length) return;
    const next = slots.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setSlots(next.map((s, idx) => ({ ...s, slot_index: idx })));
  }

  function setSlotRole(i: number, role: ApproverRole) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, minimum_role: role } : s)));
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    if (slots.length === 0) {
      toast({ title: 'At least one slot required', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        ...(chain?.id ? { id: chain.id } : {}),
        name: name.trim(),
        slots: slots.map((s, i) => ({ slot_index: i, minimum_role: s.minimum_role })),
        priority,
        expiration_hours: expirationHours,
      };
      const res = await fetch(`/api/policy/versions/${versionId}/approval-chains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.human_readable ?? err.error ?? `Save failed (${res.status})`);
      }
      toast({ title: editing ? 'Chain updated' : 'Chain added', variant: 'success' });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Could not save chain',
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
            <IconTile variant="info" size="sm" emphasized>
              <Users />
            </IconTile>
            <DialogTitle className="m-0">
              {editing ? 'Edit approval chain' : 'New approval chain'}
            </DialogTitle>
          </div>
          <DialogDescription>
            A chain defines the ordered sign-off ladder for rules that reference it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Chain name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Large transfer approval"
              maxLength={200}
            />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-foreground">Sign-off slots</div>
              <Button variant="outline" size="sm" onClick={addSlot}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add slot
              </Button>
            </div>

            <div className="space-y-2">
              {slots.map((s, i) => (
                <SlotRow
                  key={i}
                  index={i}
                  role={s.minimum_role}
                  canMoveUp={i > 0}
                  canMoveDown={i < slots.length - 1}
                  canDelete={slots.length > 1}
                  showArrow={i < slots.length - 1}
                  onRoleChange={(r) => setSlotRole(i, r)}
                  onMoveUp={() => moveSlot(i, -1)}
                  onMoveDown={() => moveSlot(i, +1)}
                  onDelete={() => removeSlot(i)}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Approvals fill top to bottom. Each slot must be filled by a user whose role
              meets or exceeds the minimum.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority" helper="Lower = higher priority when multiple chains match.">
              <Input
                type="number"
                min={0}
                step={1}
                value={String(priority)}
                onChange={(e) => setPriority(Math.max(0, Number(e.target.value) || 0))}
              />
            </Field>
            <Field label="Expiration" helper="Hours before pending requests auto-expire.">
              <Input
                type="number"
                min={1}
                max={720}
                step={1}
                value={String(expirationHours)}
                onChange={(e) => setExpirationHours(Math.max(1, Number(e.target.value) || 24))}
                trailingIcon={<span className="text-muted-foreground text-xs">hours</span>}
              />
            </Field>
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
                {editing ? 'Save changes' : 'Add chain'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlotRow({
  index,
  role,
  canMoveUp,
  canMoveDown,
  canDelete,
  showArrow,
  onRoleChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  index: number;
  role: ApproverRole;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  showArrow: boolean;
  onRoleChange: (r: ApproverRole) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
        <Badge variant="info-blue" size="sm" className="font-mono tabular-nums shrink-0">
          Slot {index + 1}
        </Badge>
        <div className="flex-1">
          <Select value={role} onChange={(e) => onRoleChange(e.target.value as ApproverRole)}>
            {APPROVER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className={cn(
              'p-1.5 rounded-md transition-colors text-muted-foreground',
              canMoveUp ? 'hover:bg-white/[0.04] hover:text-foreground' : 'opacity-30 cursor-not-allowed',
            )}
            aria-label="Move slot up"
            title="Move up"
          >
            <ArrowDown className="w-3.5 h-3.5 rotate-180" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className={cn(
              'p-1.5 rounded-md transition-colors text-muted-foreground',
              canMoveDown ? 'hover:bg-white/[0.04] hover:text-foreground' : 'opacity-30 cursor-not-allowed',
            )}
            aria-label="Move slot down"
            title="Move down"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!canDelete}
            className={cn(
              'p-1.5 rounded-md transition-colors text-muted-foreground',
              canDelete ? 'hover:bg-red-500/10 hover:text-red-400' : 'opacity-30 cursor-not-allowed',
            )}
            aria-label="Remove slot"
            title="Remove"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {showArrow && (
        <div className="flex justify-center py-1 opacity-40">
          <ArrowDown className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
