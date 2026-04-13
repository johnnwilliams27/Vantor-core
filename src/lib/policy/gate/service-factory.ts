// src/lib/policy/gate/service-factory.ts
//
// Factory that constructs a production PolicyGateService wired with
// the real evaluate function and approval workflow. Extracted from
// route handlers so tests can `vi.mock` this module and replace the
// factory with one that returns a stub gate for specific verdicts.
//
// Before this extraction, each gated route inlined:
//
//   const gateService = new PolicyGateService(supabase, {
//     evaluate: buildProductionEvaluate(supabase),
//     approvalService: new ApprovalWorkflowService(supabase),
//   });
//
// That meant route-level behavioral tests (allow_auto vs
// require_approval vs GateError → correct HTTP response) couldn't be
// written without spinning up the entire engine + DB. With a factory
// seam, the tests mock this module and each verdict becomes a
// single-line stub.

import type { SupabaseClient } from '@supabase/supabase-js';
import { PolicyGateService } from './gate';
import { buildProductionEvaluate } from './production-wiring';
import { ApprovalWorkflowService } from '../approvals';

/**
 * Build a PolicyGateService with production dependencies. Pass the
 * same Supabase admin client that handles the rest of the request —
 * the gate uses it for evaluation persistence, approval-request
 * creation, and the RLS-bypassing reads the evaluate pipeline needs.
 */
export function buildGateService(supabase: SupabaseClient<any, any>): PolicyGateService {
  return new PolicyGateService(supabase, {
    evaluate: buildProductionEvaluate(supabase),
    approvalService: new ApprovalWorkflowService(supabase),
  });
}
