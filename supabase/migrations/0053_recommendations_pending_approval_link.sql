-- ============================================================
-- 0053_recommendations_pending_approval_link.sql
--
-- Link ai_recommendations to their pending policy_approval_request
-- when the gate returns require_approval on the approve/slack paths.
--
-- Before: when a human-approved AI rec triggered additional policy
-- approvals (e.g. treasurer OK'd, CFO still pending), the approval
-- request was created by the gate but had no persisted link back to
-- the rec row. UI could only show "approved" or "rejected" and had to
-- guess the in-between state. With this column the UI can show
-- "Awaiting CFO (2/3 approvers)" by joining on pending_approval_request_id.
--
-- ON DELETE SET NULL — if the approval request is cancelled / cleaned
-- up, the rec should remain visible; just lose the link.
-- ============================================================

ALTER TABLE ai_recommendations
  ADD COLUMN IF NOT EXISTS pending_approval_request_id
    UUID REFERENCES policy_approval_requests(id) ON DELETE SET NULL;

COMMENT ON COLUMN ai_recommendations.pending_approval_request_id IS
  'Set when the gate returned require_approval during the human-approve step. Points to the policy_approval_requests row the executor will consume when the approval chain completes. NULL means no gate-mediated pending approval.';

-- Partial index supports queries like "show me recs awaiting additional approval"
-- without scanning every rec row.
CREATE INDEX IF NOT EXISTS idx_ai_recs_pending_approval
  ON ai_recommendations(pending_approval_request_id)
  WHERE pending_approval_request_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
