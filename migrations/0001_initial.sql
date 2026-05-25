CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  beta_status TEXT NOT NULL DEFAULT 'invited',
  kyc_status TEXT NOT NULL DEFAULT 'not_started',
  compliance_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  available_cents INTEGER NOT NULL DEFAULT 0,
  locked_cents INTEGER NOT NULL DEFAULT 0,
  pending_withdrawal_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (available_cents >= 0),
  CHECK (locked_cents >= 0),
  CHECK (pending_withdrawal_cents >= 0)
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id),
  claim TEXT NOT NULL,
  resolution_criteria TEXT NOT NULL,
  creator_side TEXT NOT NULL CHECK (creator_side IN ('YES', 'NO')),
  stake_cents INTEGER NOT NULL,
  matched_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  dispute_deadline_at TEXT,
  provisional_outcome TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (stake_cents >= 0),
  CHECK (matched_cents >= 0),
  CHECK (matched_cents <= stake_cents)
);

CREATE TABLE IF NOT EXISTS challenge_matches (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  matcher_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('YES', 'NO')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount_cents > 0)
);

CREATE TABLE IF NOT EXISTS resolution_runs (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  exa_query TEXT NOT NULL,
  source_urls TEXT NOT NULL DEFAULT '[]',
  ai_rationale TEXT NOT NULL,
  proposed_outcome TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  challenger_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  admin_decision TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
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
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_matches_challenge ON challenge_matches(challenge_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_resolution_challenge ON resolution_runs(challenge_id, created_at);
