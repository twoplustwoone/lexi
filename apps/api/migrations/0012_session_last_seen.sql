-- When a session was last presented.
--
-- A session that is still valid but no longer being used is the only trace
-- storage eviction leaves, and it was previously reconstructed by scanning
-- every accepted-session log record in the window. That is state kept as an
-- append-only event stream: it forced a heartbeat row on every app open, and
-- reading it back meant paging thousands of rows into a phone to compute one
-- number per session. It belongs on the session.
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;

UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_at ON sessions(last_seen_at);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
