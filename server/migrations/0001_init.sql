-- Polish service schema. Users' text is never stored anywhere.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_norm TEXT NOT NULL UNIQUE,
  google_sub TEXT UNIQUE,
  balance_credits INTEGER NOT NULL DEFAULT 0,
  starter_granted_at INTEGER,
  disabled_at INTEGER,
  disabled_reason TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('starter','purchase','hold','settle','refund','reversal','admin_grant')),
  delta_credits INTEGER NOT NULL,
  ref TEXT UNIQUE,
  request_id TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  raw_cost_micro INTEGER,
  credits_charged INTEGER,
  mode TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ledger_user ON ledger(user_id, created_at);
CREATE INDEX ledger_request ON ledger(request_id);

-- The ledger is the only write path for balances.
CREATE TRIGGER ledger_apply AFTER INSERT ON ledger BEGIN
  UPDATE users SET balance_credits = balance_credits + NEW.delta_credits WHERE id = NEW.user_id;
END;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('web','desktop','extension')),
  device_name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  email_norm TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX login_codes_email ON login_codes(email_norm, created_at);

CREATE TABLE device_codes (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  device_name TEXT,
  user_id TEXT,
  approved_at INTEGER,
  denied_at INTEGER,
  consumed_at INTEGER,
  last_poll_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  device_name TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  return_to TEXT,
  expires_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE daily_usage (
  day TEXT PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  raw_cost_micro INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE paddle_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
