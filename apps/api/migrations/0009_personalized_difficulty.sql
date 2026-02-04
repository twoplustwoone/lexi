-- Add per-user difficulty tracking metadata for delivered words
ALTER TABLE user_words ADD COLUMN requested_difficulty TEXT;
ALTER TABLE user_words ADD COLUMN effective_difficulty TEXT;

-- Per-user cycle state by difficulty band
CREATE TABLE IF NOT EXISTS user_word_cycle_state (
  user_id TEXT NOT NULL,
  difficulty_band TEXT NOT NULL CHECK (difficulty_band IN ('easy', 'balanced', 'advanced')),
  current_cycle INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, difficulty_band)
);

-- Per-user usage log to avoid repeats inside each difficulty cycle
CREATE TABLE IF NOT EXISTS user_word_usage_log (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  word_pool_id INTEGER NOT NULL,
  difficulty_band TEXT NOT NULL CHECK (difficulty_band IN ('easy', 'balanced', 'advanced')),
  cycle INTEGER NOT NULL,
  used_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, word_pool_id, difficulty_band, cycle),
  FOREIGN KEY (word_pool_id) REFERENCES word_pool(id)
);

CREATE INDEX IF NOT EXISTS idx_user_word_usage_user_band_cycle
  ON user_word_usage_log(user_id, difficulty_band, cycle);

CREATE INDEX IF NOT EXISTS idx_user_word_usage_used_on
  ON user_word_usage_log(used_on);

-- Backfill missing tier values from SCOWL-like source tags (example: american-words.50)
UPDATE word_pool
SET tier = CAST(substr(source, instr(source, '.') + 1) AS INTEGER)
WHERE tier IS NULL
  AND instr(source, '.') > 0
  AND substr(source, instr(source, '.') + 1) GLOB '[0-9]*';
