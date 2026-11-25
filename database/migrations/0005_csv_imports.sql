ALTER TABLE auto_finance.ledger_entries
  ADD COLUMN category text CHECK (category IS NULL OR char_length(category) BETWEEN 1 AND 80),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12);

GRANT UPDATE (category, tags) ON auto_finance.ledger_entries TO auto_finance_api;

CREATE TABLE auto_finance.import_batches (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  account_id uuid,
  card_id uuid,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  CHECK (num_nonnulls(account_id, card_id) = 1),
  FOREIGN KEY (workspace_id, account_id) REFERENCES auto_finance.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, card_id) REFERENCES auto_finance.cards(workspace_id, id)
);

CREATE UNIQUE INDEX import_batches_account_digest_idx
  ON auto_finance.import_batches (workspace_id, account_id, digest) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX import_batches_card_digest_idx
  ON auto_finance.import_batches (workspace_id, card_id, digest) WHERE card_id IS NOT NULL;
CREATE INDEX import_batches_workspace_date_idx ON auto_finance.import_batches (workspace_id, created_at DESC, id);

CREATE TABLE auto_finance.import_rows (
  workspace_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  line integer NOT NULL CHECK (line >= 2),
  status text NOT NULL CHECK (status IN ('created', 'linked', 'skipped', 'rejected', 'duplicate')),
  external_digest text CHECK (external_digest IS NULL OR external_digest ~ '^[0-9a-f]{64}$'),
  entry_id uuid,
  adjustment_id uuid,
  PRIMARY KEY (workspace_id, batch_id, line),
  FOREIGN KEY (workspace_id, batch_id) REFERENCES auto_finance.import_batches(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entry_id) REFERENCES auto_finance.ledger_entries(workspace_id, id),
  FOREIGN KEY (workspace_id, adjustment_id) REFERENCES auto_finance.financial_adjustments(workspace_id, id),
  CHECK (
    (status = 'created' AND entry_id IS NOT NULL AND adjustment_id IS NULL)
    OR (status = 'linked' AND num_nonnulls(entry_id, adjustment_id) = 1)
    OR (status IN ('skipped', 'rejected', 'duplicate') AND entry_id IS NULL AND adjustment_id IS NULL AND external_digest IS NULL)
  )
);
CREATE INDEX import_rows_external_digest_idx ON auto_finance.import_rows(workspace_id, external_digest)
  WHERE external_digest IS NOT NULL;
CREATE INDEX import_rows_entry_idx ON auto_finance.import_rows (workspace_id, entry_id)
  WHERE entry_id IS NOT NULL;
CREATE INDEX import_rows_adjustment_idx ON auto_finance.import_rows (workspace_id, adjustment_id)
  WHERE adjustment_id IS NOT NULL;

GRANT SELECT, INSERT ON auto_finance.import_batches, auto_finance.import_rows TO auto_finance_api;
