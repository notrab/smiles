-- Magic link sign-in. A login token is single use and short lived; it is
-- swapped at the callback for a session that the dashboard carries.
CREATE TABLE login_tokens (
  token      TEXT PRIMARY KEY,
  site_key   TEXT NOT NULL REFERENCES sites(key) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  site_key   TEXT NOT NULL REFERENCES sites(key) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX sessions_site ON sessions (site_key);
