-- Add an explicit difficulty category so selection no longer relies on SCOWL tier alone.
ALTER TABLE word_pool ADD COLUMN difficulty_category TEXT NOT NULL DEFAULT 'balanced';

-- Backfill from current tier values. Unknown/legacy words default to easy rather than being
-- implicitly treated as balanced by selection logic.
UPDATE word_pool
SET difficulty_category = CASE
  WHEN tier IS NOT NULL AND tier > 60 THEN 'advanced'
  WHEN tier IS NOT NULL AND tier > 35 THEN 'balanced'
  ELSE 'easy'
END;

CREATE INDEX IF NOT EXISTS idx_word_pool_difficulty_category
  ON word_pool(difficulty_category, enabled);
