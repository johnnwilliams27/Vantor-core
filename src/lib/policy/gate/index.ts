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
  SupabaseLike,
} from './gate';

export { mapTransferToMovement } from './movement-mapper';
export type { TransferMovementInput, MapperContext } from './movement-mapper';

export { mapGateErrorToHttp } from './http';
export type { GateErrorBody } from './http';
