// src/lib/policy/gate/errors.ts

import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface GateErrorInit extends Omit<PolicyErrorInit, 'module'> {}

/**
 * Structured error for the policy gate layer.
 * Same pattern as ApprovalError: extends PolicyError with module='gate'.
 */
export class GateError extends PolicyError {
  constructor(init: GateErrorInit) {
    super({ ...init, module: 'gate' });
    this.name = 'GateError';
  }

  toJSON(): PolicyErrorEnvelope {
    return super.toJSON();
  }
}
