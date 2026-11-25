import type { Pool } from 'pg'

export interface HolderInput {
  id: string
  name: string
}

export interface AccountInput extends HolderInput {
  holderId: string
  kind: 'bank' | 'cash'
  openingBalanceCents: number
  openingDate: string
  includeInBalance: boolean
}

export interface CardInput extends HolderInput {
  holderId: string
  paymentAccountId?: string
  lastFour?: string
  limitCents: number
  closingDay: number
  dueDay: number
}

export interface EntryInput {
  id: string
  kind: 'income' | 'expense' | 'purchase'
  instrumentId: string
  description: string
  amountCents: number
  occurredOn: string
}

export interface EntryFilter {
  from?: string
  to?: string
  accountId?: string
  cardId?: string
  kind?: EntryInput['kind']
  search?: string
  page?: number
}

export interface LedgerCatalog {
  holders: HolderInput[]
  accounts: (Omit<AccountInput, 'openingBalanceCents'> & { openingBalanceCents: string; balanceCents: string })[]
  cards: (Omit<CardInput, 'paymentAccountId' | 'lastFour' | 'limitCents'> & {
    limitCents: string
    lastFour: string | null
    paymentAccountId: string | null
  })[]
}

export interface Statement {
  entries: (Omit<EntryInput, 'instrumentId' | 'amountCents'> & {
    amountCents: string
    instrumentName: string
    holderName: string
  })[]
  count: number
  incomeCents: string
  expenseCents: string
  purchaseCents: string
  page: number
  pageSize: number
}

export async function getCatalog(database: Pool, workspaceId: string): Promise<LedgerCatalog> {
  const [holders, accounts, cards] = await Promise.all([
    database.query<LedgerCatalog['holders'][number]>(
      'SELECT id, name FROM auto_finance.holders WHERE workspace_id = $1 ORDER BY name, id',
      [workspaceId],
    ),
    database.query<LedgerCatalog['accounts'][number]>(
      `SELECT a.id, a.name, a.kind, a.holder_id AS "holderId",
              a.opening_balance_cents::text AS "openingBalanceCents",
              to_char(a.opening_date, 'YYYY-MM-DD') AS "openingDate",
              a.include_in_balance AS "includeInBalance",
              (CASE WHEN a.opening_date <= calendar.today
                THEN a.opening_balance_cents + COALESCE(e.net, 0) ELSE 0 END)::text AS "balanceCents"
         FROM auto_finance.accounts a
         CROSS JOIN (SELECT timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::date AS today) calendar
         LEFT JOIN LATERAL (
           SELECT sum(CASE WHEN l.kind = 'income' THEN l.amount_cents ELSE -l.amount_cents END) AS net
           FROM auto_finance.ledger_entries l
           WHERE l.workspace_id = a.workspace_id AND l.account_id = a.id
             AND l.occurred_on BETWEEN a.opening_date AND calendar.today
         ) e ON true
         WHERE a.workspace_id = $1
         ORDER BY a.name, a.id`,
      [workspaceId],
    ),
    database.query<LedgerCatalog['cards'][number]>(
      `SELECT id, name, holder_id AS "holderId", payment_account_id AS "paymentAccountId",
              last_four AS "lastFour", limit_cents::text AS "limitCents",
              closing_day AS "closingDay", due_day AS "dueDay"
         FROM auto_finance.cards WHERE workspace_id = $1 ORDER BY name, id`,
      [workspaceId],
    ),
  ])
  return { holders: holders.rows, accounts: accounts.rows, cards: cards.rows }
}

const pageSize = 25

export async function getStatement(database: Pool, workspaceId: string, filter: EntryFilter): Promise<Statement> {
  const page = filter.page ?? 1
  const { rows: [result] } = await database.query<Omit<Statement, 'page' | 'pageSize'>>(
    `WITH filtered AS (
       SELECT l.id, l.kind, l.description, l.amount_cents, l.occurred_on, l.created_at,
              COALESCE(a.name, c.name) AS instrument_name, h.name AS holder_name
       FROM auto_finance.ledger_entries l
       LEFT JOIN auto_finance.accounts a ON a.workspace_id = l.workspace_id AND a.id = l.account_id
       LEFT JOIN auto_finance.cards c ON c.workspace_id = l.workspace_id AND c.id = l.card_id
       JOIN auto_finance.holders h ON h.workspace_id = l.workspace_id AND h.id = COALESCE(a.holder_id, c.holder_id)
       WHERE l.workspace_id = $1
         AND ($2::date IS NULL OR l.occurred_on >= $2)
         AND ($3::date IS NULL OR l.occurred_on <= $3)
         AND ($4::uuid IS NULL OR l.account_id = $4)
         AND ($5::uuid IS NULL OR l.card_id = $5)
         AND ($6::text IS NULL OR l.kind = $6)
         AND ($7::text IS NULL OR strpos(lower(l.description), lower($7)) > 0)
     ), page_entries AS (
       SELECT id, kind, description, amount_cents::text AS "amountCents",
              to_char(occurred_on, 'YYYY-MM-DD') AS "occurredOn",
              instrument_name AS "instrumentName", holder_name AS "holderName",
              occurred_on, created_at
       FROM filtered ORDER BY occurred_on DESC, created_at DESC, id DESC LIMIT $8 OFFSET $9
     )
     SELECT count(*)::integer AS count,
            coalesce(sum(amount_cents) FILTER (WHERE kind = 'income'), 0)::text AS "incomeCents",
            coalesce(sum(amount_cents) FILTER (WHERE kind = 'expense'), 0)::text AS "expenseCents",
            coalesce(sum(amount_cents) FILTER (WHERE kind = 'purchase'), 0)::text AS "purchaseCents",
            coalesce((SELECT jsonb_agg(to_jsonb(p) - 'occurred_on' - 'created_at'
                ORDER BY p.occurred_on DESC, p.created_at DESC, p.id DESC) FROM page_entries p), '[]') AS entries
     FROM filtered`,
    [workspaceId, filter.from ?? null, filter.to ?? null, filter.accountId ?? null,
      filter.cardId ?? null, filter.kind ?? null, filter.search ?? null, pageSize, (page - 1) * pageSize],
  )
  return { ...result, page, pageSize }
}

export async function addHolder(database: Pool, workspaceId: string, record: HolderInput): Promise<boolean> {
  const result = await database.query(
    'INSERT INTO auto_finance.holders (workspace_id, id, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [workspaceId, record.id, record.name.trim()],
  )
  return result.rowCount === 1
}

export async function addAccount(database: Pool, workspaceId: string, record: AccountInput): Promise<boolean> {
  const result = await database.query(
    `INSERT INTO auto_finance.accounts
       (workspace_id, id, holder_id, name, kind, opening_balance_cents, opening_date, include_in_balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
    [workspaceId, record.id, record.holderId, record.name.trim(), record.kind, record.openingBalanceCents,
      record.openingDate, record.includeInBalance],
  )
  return result.rowCount === 1
}

export async function addCard(database: Pool, workspaceId: string, record: CardInput): Promise<boolean> {
  const result = await database.query(
    `INSERT INTO auto_finance.cards
       (workspace_id, id, holder_id, payment_account_id, name, last_four, limit_cents, closing_day, due_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
    [workspaceId, record.id, record.holderId, record.paymentAccountId ?? null, record.name.trim(),
      record.lastFour ?? null, record.limitCents, record.closingDay, record.dueDay],
  )
  return result.rowCount === 1
}

export async function addEntry(database: Pool, workspaceId: string, entry: EntryInput): Promise<boolean> {
  const card = entry.kind === 'purchase'
  const result = await database.query(
    `INSERT INTO auto_finance.ledger_entries
       (workspace_id, id, kind, account_id, card_id, description, amount_cents, occurred_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
    [workspaceId, entry.id, entry.kind, card ? null : entry.instrumentId, card ? entry.instrumentId : null,
      entry.description.trim(), entry.amountCents, entry.occurredOn],
  )
  return result.rowCount === 1
}
