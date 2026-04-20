export type ExistingTxRow = { id: string; status: string } | null | undefined;

export type ExistingTxAction =
  | { kind: 'insert' }
  | { kind: 'promote'; txId: string }
  | { kind: 'conflict' };

/**
 * Decide whether an existing yield_transactions row (matched by tx_hash)
 * should block this confirm-deposit call (conflict), be promoted from
 * pending → completed, or is absent and we should insert fresh.
 */
export function decideExistingTxAction(row: ExistingTxRow): ExistingTxAction {
  if (!row) return { kind: 'insert' };
  if (row.status === 'pending') return { kind: 'promote', txId: row.id };
  return { kind: 'conflict' };
}
