-- Smiles: everything the app stores.

CREATE TABLE sites (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  question    TEXT NOT NULL DEFAULT 'How are we doing?',
  admin_token TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE answers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_key   TEXT NOT NULL REFERENCES sites(key) ON DELETE CASCADE,
  answer     TEXT NOT NULL CHECK (answer IN ('great', 'ok', 'bad')),
  note       TEXT,
  page       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX answers_site_created ON answers (site_key, created_at);

-- Where answers get sent. `config` is JSON, shaped by `kind`:
--   email   {"to":"you@example.com","from":"Smiles <smiles@yourdomain.com>"}
--   slack   {"webhook_url":"https://hooks.slack.com/services/..."}
--   discord {"webhook_url":"https://discord.com/api/webhooks/..."}
--   webhook {"url":"https://example.com/hook","secret":"optional-hmac-key"}
CREATE TABLE destinations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_key   TEXT NOT NULL REFERENCES sites(key) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('email', 'slack', 'discord', 'webhook')),
  label      TEXT,
  config     TEXT NOT NULL,
  only_bad   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX destinations_site ON destinations (site_key);

-- Short-lived nonces for the "Connect..." OAuth round trips.
--   verifier — PKCE code_verifier (Resend); NULL for the secret-based providers
--   extra    — JSON carried across the redirect, e.g. the email to notify
CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  site_key   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  verifier   TEXT,
  extra      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
