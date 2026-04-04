ALTER TABLE word_details ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending_review';
ALTER TABLE word_details ADD COLUMN reviewed_at TEXT;
ALTER TABLE word_details ADD COLUMN reviewed_by TEXT;
ALTER TABLE word_details ADD COLUMN review_note TEXT;

UPDATE word_details
SET review_status = 'approved',
    reviewed_at = COALESCE(fetched_at, datetime('now')),
    reviewed_by = 'migration',
    review_note = 'Grandfathered during review-queue migration'
WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_word_details_review_status
  ON word_details(review_status, status);
