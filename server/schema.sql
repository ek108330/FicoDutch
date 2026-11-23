CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  handle text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_handle ON accounts (lower(handle));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_display_name ON accounts (lower(display_name));

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions (expires_at);

CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  started_at bigint NOT NULL,
  checkpoint_at bigint NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  ended_at bigint,
  checkpoint jsonb,
  report jsonb
);
CREATE INDEX IF NOT EXISTS open_matches ON matches (checkpoint_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS match_seats (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL,
  account_id uuid REFERENCES accounts(id),
  name text NOT NULL,
  starting boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, seat_id),
  UNIQUE (match_id, account_id)
);
CREATE INDEX IF NOT EXISTS match_seats_account ON match_seats (account_id, match_id);

CREATE TABLE IF NOT EXISTS player_stats (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  rating integer NOT NULL DEFAULT 1500,
  matches integer NOT NULL DEFAULT 0,
  finished integer NOT NULL DEFAULT 0,
  interrupted integer NOT NULL DEFAULT 0,
  victories integer NOT NULL DEFAULT 0,
  rounds integer NOT NULL DEFAULT 0,
  round_wins integer NOT NULL DEFAULT 0,
  score_sum bigint NOT NULL DEFAULT 0,
  best_score integer,
  dutch integer NOT NULL DEFAULT 0,
  dutch_won integer NOT NULL DEFAULT 0,
  reactions integer NOT NULL DEFAULT 0,
  penalties integer NOT NULL DEFAULT 0,
  exchanges integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS account_matches (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  ended_at bigint NOT NULL,
  status text NOT NULL,
  rating integer,
  opponents jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, match_id)
);
CREATE INDEX IF NOT EXISTS account_matches_recent ON account_matches (account_id, ended_at DESC, match_id DESC);
CREATE INDEX IF NOT EXISTS account_matches_ratings ON account_matches (account_id, ended_at DESC) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_matches_finished ON account_matches (account_id, ended_at DESC) WHERE status = 'finished';

CREATE TABLE IF NOT EXISTS rivalries (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rival_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  played integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, rival_id)
);
CREATE INDEX IF NOT EXISTS rivalries_frequency ON rivalries (account_id, played DESC, rival_id);
CREATE INDEX IF NOT EXISTS rivalries_wins ON rivalries (account_id, played DESC, rival_id) WHERE wins > losses;
CREATE INDEX IF NOT EXISTS rivalries_losses ON rivalries (account_id, played DESC, rival_id) WHERE losses > wins;
