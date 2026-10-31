-- Preserve historical declarations as "has uniform" without updating locked rows.
-- This value is meaningful only when declared_at is present.
ALTER TABLE daily_uniform_confirmations ADD COLUMN declared_has_uniform INTEGER NOT NULL DEFAULT 1 CHECK(declared_has_uniform IN (0,1));
