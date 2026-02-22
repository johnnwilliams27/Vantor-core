-- ============================================================
-- 0003_seed_dev.sql  – Dev seed data (non-production)
-- ============================================================
-- NOTE: Run this only in development. Creates a test treasury_manager
-- user via Supabase auth admin API in your seed script, then insert:

-- Example: after creating user via auth.admin.createUser, insert:
-- INSERT INTO user_profiles (id, email, full_name, role, onboarding_done)
-- VALUES ('YOUR-UUID', 'admin@example.com', 'Admin User', 'treasury_manager', true);

-- Placeholder rows for local testing (replace UUIDs with real ones)
DO $$
DECLARE
  v_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Only insert if not already present (idempotent)
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE NOTICE 'Seed user not found – skipping seed. Create via Supabase dashboard first.';
  END IF;
END;
$$;
