CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  handle text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_handle ON accounts (lower(handle));
CREATE UNIQUE INDEX IF NOT EXISTS accounts_display_name ON accounts (lower(display_name));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_demo_bot boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_style smallint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND conname = 'accounts_avatar_palette_range') THEN
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_avatar_style_check;
    ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_avatar_style_range;
    ALTER TABLE accounts ADD CONSTRAINT accounts_avatar_palette_range CHECK (avatar_style BETWEEN 0 AND 1191);
  END IF;
END
$$;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_photo_id uuid;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_photo bytea;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS registered_at bigint;
ALTER TABLE accounts ALTER COLUMN registered_at SET DEFAULT (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_avatar_photo ON accounts (avatar_photo_id) WHERE avatar_photo_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS account_sessions_expiry ON account_sessions (expires_at);

CREATE TABLE IF NOT EXISTS friendships (
  first_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  second_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (first_id, second_id),
  CHECK (first_id < second_id),
  CHECK (requester_id IN (first_id, second_id))
);
CREATE INDEX IF NOT EXISTS friendships_second ON friendships (second_id, first_id);

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
CREATE INDEX IF NOT EXISTS matches_table ON matches (id text_pattern_ops);

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
ALTER TABLE match_seats ADD COLUMN IF NOT EXISTS guest_token_hash text;
ALTER TABLE match_seats ADD COLUMN IF NOT EXISTS departure text;

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

CREATE INDEX IF NOT EXISTS player_stats_elo ON player_stats (rating DESC, account_id);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS rn double precision NOT NULL DEFAULT 50 CHECK (rn BETWEEN 0 AND 99);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS rn_rounds integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS player_stats_rn ON player_stats (
  rn DESC, matches DESC, (CASE WHEN rounds = 0 THEN 0 ELSE round_wins::double precision / rounds END) DESC, account_id
);

CREATE TABLE IF NOT EXISTS rated_rounds (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  number integer NOT NULL,
  scores jsonb NOT NULL,
  PRIMARY KEY (match_id, number)
);
CREATE TABLE IF NOT EXISTS round_rating_entries (
  match_id text NOT NULL,
  number integer NOT NULL,
  at bigint NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  before_rn double precision NOT NULL,
  after_rn double precision NOT NULL,
  result_score smallint NOT NULL,
  PRIMARY KEY (match_id, number, account_id),
  FOREIGN KEY (match_id, number) REFERENCES rated_rounds(match_id, number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS round_rating_account_time ON round_rating_entries (account_id, at DESC);

CREATE TABLE IF NOT EXISTS rating_flags (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  opponent_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  last_seen bigint NOT NULL,
  PRIMARY KEY (account_id, opponent_id, kind)
);
CREATE TABLE IF NOT EXISTS rating_reports (
  reporter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reported_at bigint NOT NULL,
  PRIMARY KEY (reporter_id, account_id)
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
