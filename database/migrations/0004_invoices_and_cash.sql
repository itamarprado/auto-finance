CREATE TABLE auto_finance.card_installment_plans (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  card_id uuid NOT NULL,
  description text NOT NULL CHECK (description = btrim(description) AND char_length(description) BETWEEN 1 AND 160),
  total_cents bigint NOT NULL CHECK (total_cents BETWEEN installment_count AND 9007199254740991),
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 2 AND 60),
  purchased_on date NOT NULL,
  first_cycle date NOT NULL CHECK (extract(day FROM first_cycle) = 1),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, card_id) REFERENCES auto_finance.cards(workspace_id, id)
);

CREATE TABLE auto_finance.financial_adjustments (
  workspace_id uuid NOT NULL REFERENCES auto_finance.workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  kind text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  occurred_on date NOT NULL,
  description text NOT NULL CHECK (description = btrim(description) AND char_length(description) BETWEEN 1 AND 160),
  card_id uuid,
  cycle_month date CHECK (cycle_month IS NULL OR extract(day FROM cycle_month) = 1),
  account_id uuid,
  destination_id uuid,
  purchase_id uuid,
  plan_id uuid,
  payment_id uuid,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, card_id) REFERENCES auto_finance.cards(workspace_id, id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES auto_finance.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, destination_id) REFERENCES auto_finance.accounts(workspace_id, id),
  FOREIGN KEY (workspace_id, purchase_id) REFERENCES auto_finance.ledger_entries(workspace_id, id),
  FOREIGN KEY (workspace_id, plan_id) REFERENCES auto_finance.card_installment_plans(workspace_id, id),
  FOREIGN KEY (workspace_id, payment_id) REFERENCES auto_finance.financial_adjustments(workspace_id, id),
  UNIQUE (workspace_id, payment_id),
  CHECK (
    (kind = 'transfer' AND account_id IS NOT NULL AND destination_id IS NOT NULL AND account_id <> destination_id
      AND card_id IS NULL AND cycle_month IS NULL AND purchase_id IS NULL AND plan_id IS NULL AND payment_id IS NULL)
    OR
    (kind = 'refund' AND card_id IS NOT NULL AND cycle_month IS NOT NULL AND account_id IS NULL
      AND destination_id IS NULL AND num_nonnulls(purchase_id, plan_id) = 1 AND payment_id IS NULL)
    OR
    (kind IN ('payment', 'payment_reversal') AND card_id IS NOT NULL AND cycle_month IS NOT NULL
      AND account_id IS NOT NULL AND destination_id IS NULL AND purchase_id IS NULL AND plan_id IS NULL
      AND (kind = 'payment_reversal') = (payment_id IS NOT NULL))
  )
);

CREATE INDEX card_installment_plans_card_idx ON auto_finance.card_installment_plans (workspace_id, card_id, first_cycle);
CREATE INDEX financial_adjustments_card_cycle_idx ON auto_finance.financial_adjustments (workspace_id, card_id, cycle_month);
CREATE INDEX financial_adjustments_account_date_idx ON auto_finance.financial_adjustments (workspace_id, account_id, occurred_on);
CREATE INDEX financial_adjustments_destination_date_idx ON auto_finance.financial_adjustments (workspace_id, destination_id, occurred_on);

CREATE FUNCTION auto_finance.purchase_cycle(purchased_on date, closing_day integer)
RETURNS date
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog
RETURN (date_trunc('month', purchased_on::timestamp)
  + CASE WHEN extract(day FROM purchased_on) > closing_day THEN interval '1 month' ELSE interval '0' END)::date;

CREATE VIEW auto_finance.invoice_charges WITH (security_invoker = true) AS
SELECT l.workspace_id, l.card_id, l.id, 'purchase'::text AS source, l.description, l.occurred_on AS purchased_on,
       auto_finance.purchase_cycle(l.occurred_on, c.closing_day) AS cycle_month,
       l.amount_cents, 1 AS installment_number, 1 AS installment_count
FROM auto_finance.ledger_entries l
JOIN auto_finance.cards c ON c.workspace_id = l.workspace_id AND c.id = l.card_id
WHERE l.kind = 'purchase'
UNION ALL
SELECT p.workspace_id, p.card_id, p.id, 'installment', p.description, p.purchased_on,
       (p.first_cycle + make_interval(months => i.number - 1))::date,
       p.total_cents / p.installment_count
         + CASE WHEN i.number = p.installment_count THEN p.total_cents % p.installment_count ELSE 0 END,
       i.number, p.installment_count
FROM auto_finance.card_installment_plans p
CROSS JOIN LATERAL generate_series(1, p.installment_count) AS i(number);

CREATE VIEW auto_finance.cash_movements WITH (security_invoker = true) AS
SELECT workspace_id, id, kind, description, occurred_on, account_id, NULL::uuid AS other_account_id,
       CASE WHEN kind = 'income' THEN amount_cents ELSE -amount_cents END AS signed_cents
FROM auto_finance.ledger_entries
WHERE account_id IS NOT NULL
UNION ALL
SELECT workspace_id, id, kind, description, occurred_on, account_id, destination_id,
       CASE WHEN kind = 'payment_reversal' THEN amount_cents ELSE -amount_cents END
FROM auto_finance.financial_adjustments
WHERE account_id IS NOT NULL
UNION ALL
SELECT workspace_id, id, 'transfer', description, occurred_on, destination_id, account_id, amount_cents
FROM auto_finance.financial_adjustments
WHERE kind = 'transfer';

REVOKE ALL ON FUNCTION auto_finance.purchase_cycle(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auto_finance.purchase_cycle(date, integer) TO auto_finance_api;
GRANT SELECT, INSERT ON auto_finance.card_installment_plans, auto_finance.financial_adjustments TO auto_finance_api;
GRANT SELECT ON auto_finance.invoice_charges, auto_finance.cash_movements TO auto_finance_api;
