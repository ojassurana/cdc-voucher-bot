PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_key TEXT PRIMARY KEY,
  dashboard_message_id INTEGER,
  dashboard_kind TEXT NOT NULL DEFAULT 'text' CHECK (dashboard_kind IN ('text', 'photo')),
  flow_state TEXT NOT NULL DEFAULT 'idle',
  flow_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voucher_sources (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  encrypted_url TEXT NOT NULL,
  encrypted_group_id TEXT NOT NULL,
  label TEXT NOT NULL,
  campaign_name TEXT,
  created_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  FOREIGN KEY (user_key) REFERENCES users(user_key) ON DELETE CASCADE,
  UNIQUE (user_key, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_voucher_sources_user
  ON voucher_sources(user_key, created_at DESC);

CREATE TABLE IF NOT EXISTS voucher_balances (
  source_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('cdc', 'supermarket', 'energy')),
  available INTEGER NOT NULL DEFAULT 0,
  voucher_count INTEGER NOT NULL DEFAULT 0,
  denominations_json TEXT NOT NULL DEFAULT '{}',
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (source_id, category),
  FOREIGN KEY (source_id) REFERENCES voucher_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voucher_balances_category
  ON voucher_balances(category, source_id);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL
);
