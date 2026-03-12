-- Test Mode: shadow test enterprise per real enterprise
-- Run manually in Supabase SQL editor

-- Add test enterprise columns
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS is_test_enterprise BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_enterprise_id UUID REFERENCES enterprises(id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_enterprises_test_enterprise_id ON enterprises(test_enterprise_id) WHERE test_enterprise_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enterprises_is_test ON enterprises(is_test_enterprise) WHERE is_test_enterprise = true;
