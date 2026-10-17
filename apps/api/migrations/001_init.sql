-- TACTICAL STRIKE: lược đồ API (PostgreSQL 16+). Credits là tiền ảo duy nhất.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  banned boolean NOT NULL DEFAULT false,
  CONSTRAINT users_username_len CHECK (char_length(username) BETWEEN 3 AND 20)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uq ON users (lower(username));

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  equipped jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('user','treasury','fee','escrow')),
  currency text NOT NULL DEFAULT 'credits' CHECK (currency = 'credits'),
  balance bigint NOT NULL DEFAULT 0,
  allow_negative boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_nonneg CHECK (allow_negative OR balance >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_owner_uq ON ledger_accounts(owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_system_uq ON ledger_accounts(kind) WHERE owner_id IS NULL;

INSERT INTO ledger_accounts (id, owner_id, kind, balance, allow_negative) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'treasury', 0, true),
  ('00000000-0000-0000-0000-000000000002', NULL, 'fee', 0, true),
  ('00000000-0000-0000-0000-000000000003', NULL, 'escrow', 0, true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idem_key text NOT NULL,
  memo text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key)
);
CREATE INDEX IF NOT EXISTS ledger_transactions_user_idx ON ledger_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  tx_id uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  delta bigint NOT NULL CHECK (delta <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_tx_idx ON ledger_entries(tx_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries(account_id);

CREATE OR REPLACE FUNCTION deny_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_transactions_no_update ON ledger_transactions;
CREATE TRIGGER ledger_transactions_no_update BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();
DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION deny_ledger_mutation();

CREATE TABLE IF NOT EXISTS skin_instances (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  skin_def_id text NOT NULL,
  pattern_seed integer NOT NULL CHECK (pattern_seed >= 0),
  wear_float numeric(6,5) NOT NULL CHECK (wear_float >= 0 AND wear_float <= 1),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  listed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS skin_instances_owner_idx ON skin_instances(owner_id);

CREATE TABLE IF NOT EXISTS market_listings (
  id uuid PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES skin_instances(id) ON DELETE RESTRICT,
  price bigint NOT NULL CHECK (price > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sold_at timestamptz,
  buyer_id uuid REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS market_one_active_per_instance ON market_listings(instance_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS market_active_idx ON market_listings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS market_trades (
  id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES market_listings(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES skin_instances(id) ON DELETE RESTRICT,
  price bigint NOT NULL CHECK (price > 0),
  fee bigint NOT NULL CHECK (fee >= 0),
  idem_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, idem_key)
);

CREATE TABLE IF NOT EXISTS store_purchases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idem_key text NOT NULL,
  product_id text NOT NULL,
  instance_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
