CREATE TABLE auto_finance.password_credentials (
  user_id uuid PRIMARY KEY REFERENCES auto_finance.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 1 AND 255)
);

CREATE TABLE auto_finance.auth_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  user_id uuid NOT NULL REFERENCES auto_finance.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_idx ON auto_finance.auth_sessions (user_id);
CREATE INDEX auth_sessions_expiry_idx ON auto_finance.auth_sessions (expires_at);

GRANT SELECT ON auto_finance.password_credentials TO auto_finance_api;
GRANT SELECT, INSERT, DELETE ON auto_finance.auth_sessions TO auto_finance_api;
