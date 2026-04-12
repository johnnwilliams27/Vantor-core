import { PolicyError, PolicyErrorInit, PolicyErrorEnvelope } from '../errors/classes';

export interface AuthoringErrorInit extends Omit<PolicyErrorInit, 'module'> {
  path?: (string | number)[];
}

export class AuthoringError extends PolicyError {
  readonly path: (string | number)[];

  constructor(init: AuthoringErrorInit) {
    super({ ...init, module: 'authoring' });
    this.name = 'AuthoringError';
    this.path = init.path ?? [];
  }

  toJSON(): PolicyErrorEnvelope & { path: (string | number)[] } {
    return {
      ...super.toJSON(),
      path: this.path,
    };
  }
}
