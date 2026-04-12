// src/lib/policy/approvals/index.ts
//
// Barrel export for the approval workflow module.

export { ApprovalError } from './errors';
export type { ApprovalErrorInit } from './errors';

export type {
  ApprovalStatus,
  DenialReason,
  SlotAssignment,
  ApprovalRequest,
  CreateApprovalInput,
  ApprovalActor,
  ListFilters,
} from './types';

export { validateSoD } from './sod';
export type { ValidateSoDParams, SoDResult } from './sod';

export {
  ApprovalWorkflowService,
  MAX_JUSTIFICATION_LEN,
} from './service';
export type {
  SupabaseLike,
  EvaluateFn,
  ApprovalWorkflowServiceOptions,
} from './service';

export { sweepExpiredApprovals } from './sweeper';

export {
  approvalRequestCreatedEmail,
  approvalSlotFilledEmail,
  approvalExecutedEmail,
  approvalDeniedEmail,
  approvalExpiredEmail,
} from './notifications';

export {
  mapApprovalErrorToHttp,
  handleApprovalRequest,
  resolveApprovalContext,
} from './http';
export type { ApprovalContext, ApprovalErrorBody } from './http';
