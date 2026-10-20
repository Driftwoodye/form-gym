CREATE TABLE IF NOT EXISTS withings_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  userid TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
