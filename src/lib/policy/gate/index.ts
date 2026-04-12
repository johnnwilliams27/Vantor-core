// src/lib/policy/gate/index.ts
//
// Barrel export for the policy gate module.

export { GateError } from './errors';
export type { GateErrorInit } from './errors';

export { PolicyGateService } from './gate';
export type {
  GateActor,
  GateResult,
  PolicyGateServiceOptions,
} from './gate';
// Note: `SupabaseLike` is intentionally NOT re-exported here to avoid
// a collision with the identical type exported from ./approvals via
// the policy-level barrel. Import directly from ./gate if needed.

export { mapTransferToMovement } from './movement-mapper';
export type { TransferMovementInput, MapperContext } from './movement-mapper';

export { mapGateErrorToHttp } from './http';
export type { GateErrorBody } from './http';
