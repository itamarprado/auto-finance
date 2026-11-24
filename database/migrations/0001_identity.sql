CREATE TABLE auto_finance.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  display_name text NOT NULL CHECK (
    display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120
  ),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auto_finance.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auto_finance.workspace_members (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auto_finance.users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_idx ON auto_finance.workspace_members (user_id);

GRANT SELECT, INSERT
  ON auto_finance.users, auto_finance.workspaces, auto_finance.workspace_members
  TO auto_finance_api;
