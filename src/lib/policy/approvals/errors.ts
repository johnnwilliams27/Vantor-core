// src/lib/policy/approvals/errors.ts

import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface ApprovalErrorInit extends Omit<PolicyErrorInit, 'module'> {}

/**
 * Structured error for the approval workflow module.
 * Same pattern as AuthoringError but without `path` (approvals don't have form fields).
 */
export class ApprovalError extends PolicyError {
  constructor(init: ApprovalErrorInit) {
    super({ ...init, module: 'approvals' });
    this.name = 'ApprovalError';
  }

  toJSON(): PolicyErrorEnvelope {
    return super.toJSON();
  }
}
