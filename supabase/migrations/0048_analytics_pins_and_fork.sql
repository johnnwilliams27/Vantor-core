-- ============================================================
-- 0048_analytics_pins_and_fork.sql
-- Pin preferences for the Analytics page + fork tracking.
-- ============================================================

-- Pin preferences: which views a user has pinned on the Analytics page.
-- Treasury Summary is always rendered at top regardless of this table.
CREATE TABLE IF NOT EXISTS analytics_pin_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  pinned_slugs  TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, enterprise_id)
);

ALTER TABLE analytics_pin_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_pin_preferences" ON analytics_pin_preferences
  FOR ALL USING (user_id = auth.uid());

-- Fork tracking: link custom views back to their source.
ALTER TABLE analytics_views
  ADD COLUMN IF NOT EXISTS forked_from UUID REFERENCES analytics_views(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
