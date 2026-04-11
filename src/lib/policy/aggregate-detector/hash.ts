// src/lib/policy/aggregate-detector/hash.ts
//
// PLACEHOLDER for Task 17. Full implementation lands in Task 26 (the
// aggregate detector). For now, this provides a deterministic hash of a
// WindowSpec so the aggregate_window leaf can locate its pre-loaded
// result in EvaluationContext.aggregates.user_specs.
//
// Hash format: sha256 of canonical JSON, sliced to 16 hex chars. Task 26
// must preserve this exact algorithm so existing user_specs keys remain
// valid across the upgrade.

import { createHash } from 'crypto';
import { WindowSpec } from '../types/ir';

export function computeWindowSpecHash(window: WindowSpec): string {
  const canonical = JSON.stringify({
    duration_ms: window.duration_ms,
    group_by: {
      initiator: window.group_by.initiator ?? false,
      counterparty: window.group_by.counterparty ?? false,
      destination: window.group_by.destination ?? false,
      asset: window.group_by.asset ?? false,
    },
    direction: window.direction ?? 'outflow',
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
