CREATE TABLE IF NOT EXISTS google_calendar_connections (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_expires_at
  ON google_calendar_connections(access_token_expires_at);

CREATE TABLE IF NOT EXISTS google_calendar_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_user_id
  ON google_calendar_oauth_states(user_id);

CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_expires_at
  ON google_calendar_oauth_states(expires_at);
