-- Add new yield protocol IDs to the enum
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'morpho_steakhouse';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'kamino_multiply';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'sky';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'ethena';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'maple';
ALTER TYPE yield_protocol_id ADD VALUE IF NOT EXISTS 'drift';
