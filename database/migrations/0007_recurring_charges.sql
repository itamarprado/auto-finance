CREATE TABLE auto_finance.recurring_series (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('subscription', 'expense', 'income')),
  cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly', 'yearly')),
  starts_on date NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE auto_finance.recurrence_versions (
  workspace_id uuid NOT NULL,
  series_id uuid NOT NULL,
  effective_on date NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  account_id uuid,
  card_id uuid,
  ends_on date CHECK (ends_on IS NULL OR ends_on >= effective_on),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, series_id, effective_on),
  CHECK (num_nonnulls(account_id, card_id) <= 1),
  FOREIGN KEY (workspace_id, series_id) REFERENCES auto_finance.recurring_series(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, account_id) REFERENCES auto_finance.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, card_id) REFERENCES auto_finance.cards(workspace_id, id)
);

CREATE TABLE auto_finance.recurrence_occurrences (
  workspace_id uuid NOT NULL,
  series_id uuid NOT NULL,
  scheduled_on date NOT NULL,
  expected_on date,
  amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents BETWEEN 1 AND 9007199254740991),
  skipped boolean NOT NULL DEFAULT false,
  entry_id uuid,
  settled_on date,
  PRIMARY KEY (workspace_id, series_id, scheduled_on),
  UNIQUE (workspace_id, entry_id),
  CHECK ((entry_id IS NULL) = (settled_on IS NULL) AND (NOT skipped OR entry_id IS NULL)),
  FOREIGN KEY (workspace_id, series_id) REFERENCES auto_finance.recurring_series(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entry_id) REFERENCES auto_finance.ledger_entries(workspace_id, id)
);

CREATE INDEX recurrence_occurrences_expected_idx ON auto_finance.recurrence_occurrences (workspace_id, expected_on);
CREATE INDEX recurrence_occurrences_settled_idx ON auto_finance.recurrence_occurrences (workspace_id, settled_on);

GRANT SELECT, INSERT ON auto_finance.recurring_series, auto_finance.recurrence_versions, auto_finance.recurrence_occurrences TO auto_finance_api;
GRANT UPDATE (amount_cents, account_id, card_id, ends_on, active) ON auto_finance.recurrence_versions TO auto_finance_api;
GRANT UPDATE (expected_on, amount_cents, skipped, entry_id, settled_on) ON auto_finance.recurrence_occurrences TO auto_finance_api;
