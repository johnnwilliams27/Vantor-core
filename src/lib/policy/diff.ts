// src/lib/policy/diff.ts
//
// Pure version-diff. Given two PolicyVersionSnapshots, return the
// set of rules / chains / hard_limits that were added, removed, or
// changed between them.
//
// Identity: entities match across versions by `id`. "Changed" means
// the ids match but structural content differs — detected by a deep
// JSON compare after stripping ephemeral fields (id, version_id,
// timestamps, counts).

import type { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from './types/policy-version';
import type { HardLimit } from './types/hard-limit';

export interface DiffEntry<T> {
  id: string;
  /** Lexically-stable name used to group side-by-side display. */
  label: string;
  before?: T;
  after?: T;
  changedFields?: string[];
}

export interface DiffSection<T> {
  added: Array<DiffEntry<T>>;
  removed: Array<DiffEntry<T>>;
  changed: Array<DiffEntry<T>>;
  unchanged: number;
}

export interface VersionDiff {
  rules: DiffSection<PolicyRule>;
  chains: DiffSection<ApprovalChain>;
  hardLimits: DiffSection<HardLimit>;
  /** Summary counts for the header strip. */
  totals: { added: number; removed: number; changed: number };
}

function ruleLabel(r: PolicyRule): string { return r.name; }
function chainLabel(c: ApprovalChain): string { return c.name; }
function limitLabel(l: HardLimit): string { return l.name; }

/** Strip fields that don't carry semantic meaning so structural compare is clean. */
function normalizeForCompare<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k === 'version_id' || k === 'created_at' || k === 'updated_at') continue;
    next[k] = v;
  }
  return next;
}

/** Compute the keys whose values differ between two objects at the top level.
 *  Nested diffs collapse to a single key — sufficient for a human-readable
 *  "changed fields" summary. */
function changedFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  for (const k of keys) {
    const av = JSON.stringify(a[k] ?? null);
    const bv = JSON.stringify(b[k] ?? null);
    if (av !== bv) out.push(k);
  }
  return out;
}

function diffSection<T extends { id: string }>(
  before: T[],
  after: T[],
  labelOf: (x: T) => string,
): DiffSection<T> {
  const beforeMap = new Map(before.map((x) => [x.id, x]));
  const afterMap = new Map(after.map((x) => [x.id, x]));

  const added: Array<DiffEntry<T>> = [];
  const removed: Array<DiffEntry<T>> = [];
  const changed: Array<DiffEntry<T>> = [];
  let unchanged = 0;

  // iterate union of ids; stable order helps UI
  const allIds = Array.from(new Set([
    ...Array.from(beforeMap.keys()),
    ...Array.from(afterMap.keys()),
  ])).sort();
  for (const id of allIds) {
    const b = beforeMap.get(id);
    const a = afterMap.get(id);
    if (!b && a) {
      added.push({ id, label: labelOf(a), after: a });
    } else if (b && !a) {
      removed.push({ id, label: labelOf(b), before: b });
    } else if (b && a) {
      const bn = normalizeForCompare(b as unknown as Record<string, unknown>);
      const an = normalizeForCompare(a as unknown as Record<string, unknown>);
      if (JSON.stringify(bn) === JSON.stringify(an)) {
        unchanged += 1;
      } else {
        changed.push({ id, label: labelOf(a), before: b, after: a, changedFields: changedFields(bn, an) });
      }
    }
  }

  return { added, removed, changed, unchanged };
}

export function computeVersionDiff(
  before: PolicyVersionSnapshot,
  after: PolicyVersionSnapshot,
): VersionDiff {
  const rules = diffSection(before.rules ?? [], after.rules ?? [], ruleLabel);
  const chains = diffSection(before.approval_chains ?? [], after.approval_chains ?? [], chainLabel);
  const hardLimits = diffSection(before.hard_limits ?? [], after.hard_limits ?? [], limitLabel);

  const totals = {
    added: rules.added.length + chains.added.length + hardLimits.added.length,
    removed: rules.removed.length + chains.removed.length + hardLimits.removed.length,
    changed: rules.changed.length + chains.changed.length + hardLimits.changed.length,
  };

  return { rules, chains, hardLimits, totals };
}
