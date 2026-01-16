-- Logging table for notification system debugging
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  user_id TEXT,
  message TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_timestamp
  ON notification_logs(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_notification_logs_category_level
  ON notification_logs(category, level);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id
  ON notification_logs(user_id);
