-- 0016_email_verification.sql
-- Add email verification support

ALTER TABLE user_profiles ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_profiles ADD COLUMN email_verification_token TEXT;
ALTER TABLE user_profiles ADD COLUMN email_verification_expires_at TIMESTAMPTZ;

CREATE INDEX idx_user_profiles_verification_token ON user_profiles(email_verification_token);
