-- 0033_password_reset.sql
-- Add password reset support to user_profiles.
-- Tokens are single-use, 1-hour expiry, cleared after successful reset.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_profiles_password_reset_token
  ON user_profiles(password_reset_token);
