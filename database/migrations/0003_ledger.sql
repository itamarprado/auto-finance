CREATE TABLE auto_finance.holders (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE auto_finance.accounts (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  holder_id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('bank', 'cash')),
  opening_balance_cents bigint NOT NULL CHECK (opening_balance_cents BETWEEN -9007199254740991 AND 9007199254740991),
  opening_date date NOT NULL,
  include_in_balance boolean NOT NULL,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, holder_id) REFERENCES auto_finance.holders(workspace_id, id)
);

CREATE TABLE auto_finance.cards (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  holder_id uuid NOT NULL,
  payment_account_id uuid,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  last_four text CHECK (last_four ~ '^[0-9]{4}$'),
  limit_cents bigint NOT NULL CHECK (limit_cents BETWEEN 0 AND 9007199254740991),
  closing_day integer NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day integer NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, holder_id) REFERENCES auto_finance.holders(workspace_id, id),
  FOREIGN KEY (workspace_id, payment_account_id) REFERENCES auto_finance.accounts(workspace_id, id)
);

CREATE TABLE auto_finance.ledger_entries (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  account_id uuid,
  card_id uuid,
  kind text NOT NULL CHECK (kind IN ('income', 'expense', 'purchase')),
  description text NOT NULL CHECK (description = btrim(description) AND char_length(description) BETWEEN 1 AND 160),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  occurred_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES auto_finance.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, card_id) REFERENCES auto_finance.cards(workspace_id, id),
  CHECK (
    (kind IN ('income', 'expense') AND account_id IS NOT NULL AND card_id IS NULL)
    OR (kind = 'purchase' AND card_id IS NOT NULL AND account_id IS NULL)
  )
);

CREATE INDEX ledger_entries_workspace_order_idx
  ON auto_finance.ledger_entries (workspace_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX ledger_entries_account_idx
  ON auto_finance.ledger_entries (workspace_id, account_id, occurred_on DESC) WHERE account_id IS NOT NULL;
CREATE INDEX ledger_entries_card_idx
  ON auto_finance.ledger_entries (workspace_id, card_id, occurred_on DESC) WHERE card_id IS NOT NULL;

GRANT SELECT, INSERT ON auto_finance.holders, auto_finance.accounts,
  auto_finance.cards, auto_finance.ledger_entries TO auto_finance_api;
