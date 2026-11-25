CREATE TABLE auto_finance.expense_splits (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  entry_id uuid,
  plan_id uuid,
  payer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, entry_id),
  UNIQUE (workspace_id, plan_id),
  CHECK (num_nonnulls(entry_id, plan_id) = 1),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES auto_finance.ledger_entries(workspace_id, id),
  FOREIGN KEY (workspace_id, plan_id) REFERENCES auto_finance.card_installment_plans(workspace_id, id),
  FOREIGN KEY (workspace_id, payer_id) REFERENCES auto_finance.holders(workspace_id, id)
);

CREATE INDEX expense_splits_workspace_created_idx ON auto_finance.expense_splits (workspace_id, created_at DESC, id);

CREATE TABLE auto_finance.split_shares (
  workspace_id uuid NOT NULL,
  split_id uuid NOT NULL,
  holder_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (workspace_id, split_id, holder_id),
  FOREIGN KEY (workspace_id, split_id) REFERENCES auto_finance.expense_splits(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, holder_id) REFERENCES auto_finance.holders(workspace_id, id)
);

CREATE TABLE auto_finance.split_settlements (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  entry_id uuid,
  transfer_id uuid,
  from_holder_id uuid NOT NULL,
  to_holder_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, entry_id),
  UNIQUE (workspace_id, transfer_id),
  CHECK (num_nonnulls(entry_id, transfer_id) = 1 AND from_holder_id <> to_holder_id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES auto_finance.ledger_entries(workspace_id, id),
  FOREIGN KEY (workspace_id, transfer_id) REFERENCES auto_finance.financial_adjustments(workspace_id, id),
  FOREIGN KEY (workspace_id, from_holder_id) REFERENCES auto_finance.holders(workspace_id, id),
  FOREIGN KEY (workspace_id, to_holder_id) REFERENCES auto_finance.holders(workspace_id, id)
);

CREATE TABLE auto_finance.split_settlement_allocations (
  workspace_id uuid NOT NULL,
  settlement_id uuid NOT NULL,
  split_id uuid NOT NULL,
  holder_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (workspace_id, settlement_id, split_id, holder_id),
  FOREIGN KEY (workspace_id, settlement_id) REFERENCES auto_finance.split_settlements(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, split_id, holder_id) REFERENCES auto_finance.split_shares(workspace_id, split_id, holder_id)
);

CREATE INDEX split_allocations_share_idx ON auto_finance.split_settlement_allocations (workspace_id, split_id, holder_id);
CREATE INDEX financial_adjustments_refund_purchase_idx ON auto_finance.financial_adjustments (workspace_id, purchase_id)
  WHERE purchase_id IS NOT NULL AND kind = 'refund';
CREATE INDEX financial_adjustments_refund_plan_idx ON auto_finance.financial_adjustments (workspace_id, plan_id)
  WHERE plan_id IS NOT NULL AND kind = 'refund';

GRANT SELECT, INSERT ON auto_finance.expense_splits, auto_finance.split_shares,
  auto_finance.split_settlements, auto_finance.split_settlement_allocations TO auto_finance_api;
