CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  preferences_json TEXT NOT NULL,
  merged_into_user_id TEXT
);

CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,
  definition TEXT NOT NULL,
  etymology TEXT NOT NULL,
  pronunciation TEXT NOT NULL,
  examples_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_words (
  user_id TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  delivered_at TEXT NOT NULL,
  delivered_on TEXT NOT NULL,
  viewed_at TEXT,
  PRIMARY KEY (user_id, word_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_words_user_date
  ON user_words(user_id, delivered_on);

CREATE TABLE IF NOT EXISTS notification_schedules (
  user_id TEXT PRIMARY KEY,
  delivery_time TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  next_delivery_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_email_password (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_oauth (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS auth_phone (
  user_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_codes (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client TEXT NOT NULL,
  metadata_json TEXT
);
