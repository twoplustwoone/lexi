-- Word pool: raw words from SCOWL or other sources
CREATE TABLE word_pool (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  tier INTEGER DEFAULT NULL,
  source TEXT DEFAULT 'scowl',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_word_pool_enabled ON word_pool(enabled);
CREATE INDEX idx_word_pool_word ON word_pool(word);

-- Daily word assignments (global, same for all users)
CREATE TABLE daily_words (
  day TEXT PRIMARY KEY,  -- YYYY-MM-DD
  word_pool_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (word_pool_id) REFERENCES word_pool(id)
);

-- Enrichment details cache
CREATE TABLE word_details (
  word_pool_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'ready', 'failed', 'not_found'
  provider TEXT DEFAULT NULL,
  payload_json TEXT DEFAULT NULL,         -- Raw provider response
  normalized_json TEXT DEFAULT NULL,      -- Normalized WordCard
  fetched_at TEXT DEFAULT NULL,
  next_retry_at TEXT DEFAULT NULL,
  retry_count INTEGER DEFAULT 0,
  error TEXT DEFAULT NULL,
  FOREIGN KEY (word_pool_id) REFERENCES word_pool(id)
);
CREATE INDEX idx_word_details_status ON word_details(status);
CREATE INDEX idx_word_details_next_retry ON word_details(next_retry_at);

-- Track used words per cycle to prevent repeats
CREATE TABLE word_usage_log (
  id INTEGER PRIMARY KEY,
  word_pool_id INTEGER NOT NULL,
  used_on TEXT NOT NULL,
  cycle INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (word_pool_id) REFERENCES word_pool(id)
);
CREATE UNIQUE INDEX idx_word_usage_word_cycle ON word_usage_log(word_pool_id, cycle);
CREATE INDEX idx_word_usage_cycle ON word_usage_log(cycle);

-- Track current cycle number
CREATE TABLE word_cycle_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton row
  current_cycle INTEGER NOT NULL DEFAULT 1
);
INSERT INTO word_cycle_state (id, current_cycle) VALUES (1, 1);
