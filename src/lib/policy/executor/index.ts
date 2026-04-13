// src/lib/policy/executor/index.ts

export type {
  Executor,
  ExecutorRegistry,
  ExecutorDeps,
  ExecuteResult,
  ExecuteStatus,
  ExecutorDenyReason,
  SupabaseLike,
} from './types';

export {
  defaultExecutorRegistry,
  resolveExecutor,
  dispatchExecute,
  dispatchDeny,
} from './registry';
