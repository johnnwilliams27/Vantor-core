import { VersionDiff } from './types';
import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { HardLimit } from '../types/hard-limit';

// Fields to compare per collection type
const RULE_FIELDS: (keyof PolicyRule)[] = [
  'rule_type',
  'name',
  'rationale',
  'priority',
  'verdict',
  'verdict_chain_id',
  'condition',
];

const HARD_LIMIT_FIELDS: (keyof HardLimit)[] = [
  'limit_type',
  'name',
  'limit_value',
  'limit_currency',
  'scope',
];

const CHAIN_FIELDS: (keyof ApprovalChain)[] = [
  'name',
  'slots',
  'trigger_condition',
  'priority',
  'expiration_hours',
];

interface DiffResult<T extends { id: string }> {
  added: T[];
  removed: T[];
  modified: Array<{ before: T; after: T; changed_fields: string[] }>;
}

function diffCollection<T extends { id: string }>(
  before: T[],
  after: T[],
  fields: (keyof T)[],
): DiffResult<T> {
  const beforeMap = new Map(before.map((item) => [item.id, item]));
  const afterMap = new Map(after.map((item) => [item.id, item]));

  const added: T[] = [];
  const removed: T[] = [];
  const modified: Array<{ before: T; after: T; changed_fields: string[] }> = [];

  // Items in after but not in before
  for (const [id, afterItem] of afterMap) {
    if (!beforeMap.has(id)) {
      added.push(afterItem);
    }
  }

  // Items in before but not in after
  for (const [id, beforeItem] of beforeMap) {
    if (!afterMap.has(id)) {
      removed.push(beforeItem);
    }
  }

  // Items in both — compare specified fields
  for (const [id, beforeItem] of beforeMap) {
    const afterItem = afterMap.get(id);
    if (!afterItem) continue;

    const changed_fields: string[] = [];
    for (const field of fields) {
      if (JSON.stringify(beforeItem[field]) !== JSON.stringify(afterItem[field])) {
        changed_fields.push(field as string);
      }
    }

    if (changed_fields.length > 0) {
      modified.push({ before: beforeItem, after: afterItem, changed_fields });
    }
  }

  return { added, removed, modified };
}

export function computeVersionDiff(
  before: PolicyVersionSnapshot,
  after: PolicyVersionSnapshot,
): VersionDiff {
  return {
    from_version_id: before.id,
    to_version_id: after.id,
    rules: diffCollection(before.rules, after.rules, RULE_FIELDS),
    hard_limits: diffCollection(before.hard_limits, after.hard_limits, HARD_LIMIT_FIELDS),
    approval_chains: diffCollection(before.approval_chains, after.approval_chains, CHAIN_FIELDS),
  };
}
