ALTER TABLE auto_finance.recurring_series
  ADD COLUMN group_name text CHECK (group_name IS NULL OR (group_name = btrim(group_name) AND char_length(group_name) BETWEEN 1 AND 80)),
  ADD COLUMN variable_amount boolean NOT NULL DEFAULT false;

ALTER TABLE auto_finance.recurrence_occurrences
  ADD COLUMN confirmed_cents bigint CHECK (confirmed_cents BETWEEN 0 AND 9007199254740991),
  ADD CONSTRAINT recurrence_confirmed_not_skipped CHECK (confirmed_cents IS NULL OR NOT skipped);

GRANT UPDATE (group_name, variable_amount) ON auto_finance.recurring_series TO auto_finance_api;
GRANT UPDATE (confirmed_cents) ON auto_finance.recurrence_occurrences TO auto_finance_api;
