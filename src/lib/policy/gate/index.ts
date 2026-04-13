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

export {
  mapTransferToMovement,
  mapYieldDepositToMovement,
  mapYieldWithdrawToMovement,
  mapRampToMovement,
  mapFiatPaymentToMovement,
  mapSwapToMovement,
  mapBridgeToMovement,
  mapScheduledOperationToMovement,
  mapRecommendationToMovement,
} from './movement-mapper';
export type {
  TransferMovementInput,
  YieldDepositMovementInput,
  YieldWithdrawMovementInput,
  RampMovementInput,
  FiatPaymentMovementInput,
  SwapMovementInput,
  BridgeMovementInput,
  ScheduledOperationMovementInput,
  RecommendationMovementInput,
  MapperContext,
} from './movement-mapper';

export { mapGateErrorToHttp } from './http';
export type { GateErrorBody } from './http';

export { buildGateService } from './service-factory';
