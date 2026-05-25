CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id)
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id),
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMP,
  refresh_token_expires_at TIMESTAMP,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  beta_status TEXT NOT NULL DEFAULT 'invited',
  kyc_status TEXT NOT NULL DEFAULT 'not_started',
  compliance_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  locked_cents INTEGER NOT NULL DEFAULT 0 CHECK (locked_cents >= 0),
  pending_withdrawal_cents INTEGER NOT NULL DEFAULT 0 CHECK (pending_withdrawal_cents >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  challenge_id TEXT,
  match_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id),
  claim TEXT NOT NULL,
  resolution_criteria TEXT NOT NULL,
  creator_side TEXT NOT NULL CHECK (creator_side IN ('YES', 'NO')),
  stake_cents INTEGER NOT NULL CHECK (stake_cents >= 0),
  matched_cents INTEGER NOT NULL DEFAULT 0 CHECK (matched_cents >= 0),
  status TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  dispute_deadline_at TIMESTAMP,
  provisional_outcome TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CHECK (matched_cents <= stake_cents)
);

CREATE TABLE IF NOT EXISTS challenge_matches (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  matcher_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resolution_runs (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  exa_query TEXT NOT NULL,
  source_urls TEXT NOT NULL DEFAULT '[]',
  ai_rationale TEXT NOT NULL,
  proposed_outcome TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  challenger_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_decision TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  max_stake_cents INTEGER NOT NULL,
  daily_stake_limit_cents INTEGER NOT NULL,
  allow_categories TEXT NOT NULL DEFAULT '[]',
  deny_categories TEXT NOT NULL DEFAULT '[]',
  last_used_at TIMESTAMP,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_matches_challenge ON challenge_matches(challenge_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_resolution_challenge ON resolution_runs(challenge_id, created_at);
