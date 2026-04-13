// src/lib/policy/executor/executors/crypto-transfer.ts
//
// crypto_transfer is a client-signed flow. The gate-held row sits in
// 'awaiting_approval' until the approval resolves. The transfers /confirm
// endpoint already does lazy-flip on read (awaiting_approval → pending on
// 'executed' approval, → denied on 'denied' approval), so the executor
// here does NOT need to touch the row — approval resolution alone is
// sufficient because the lazy-flip logic will materialize the state
// on next access.
//
// A minor wrinkle: if we DON'T flip here, a user who reads /api/transfers
// GET between approval resolution and /confirm sees 'awaiting_approval'
// until the lazy-flip in GET kicks in. That's the PR #10 design and we
// don't change it.

import type { Executor, ExecuteResult } from '../types';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';

export const cryptoTransferExecutor: Executor = {
  async execute(
    _movement: ProposedMovement,
    _request: ApprovalRequest,
  ): Promise<ExecuteResult> {
    return {
      status: 'not_applicable',
      notes: {
        kind: 'crypto_transfer',
        execution_mode: 'client_signed',
        note: 'Execution deferred to client-signed /confirm; row flips via lazy-flip on read.',
      },
    };
  },

  async deny(_movement, _request, _denialReason, _deps): Promise<void> {
    // Lazy-flip on read handles denial too — see /api/transfers/[id]/route.ts.
    // No-op here.
  },
};
