import type { PrismaClient } from '../generated/prisma/client.ts'

export interface CashFilter {
  from: string
  to: string
  accountId?: string
  page?: number
}

export interface CashStatement {
  entries: {
    id: string
    kind: 'income' | 'expense' | 'payment' | 'payment_reversal' | 'transfer' | 'reimbursement'
    description: string
    occurredOn: string
    accountId: string
    accountName: string
    otherAccountName: string | null
    signedCents: string
  }[]
  count: number
  page: number
  pageSize: number
  incomeCents: string
  expenseCents: string
  paidCents: string
  transferNetCents: string
  reimbursementNetCents: string
  netCents: string
}

export async function getCash(prisma: PrismaClient, workspaceId: string, filter: CashFilter): Promise<CashStatement> {
  const page = filter.page ?? 1
  const pageSize = 25
  const [report] = await prisma.$queryRaw<Omit<CashStatement, 'page' | 'pageSize'>[]>`
    WITH filtered AS (
      SELECT m.id, CASE WHEN s.id IS NULL THEN m.kind ELSE 'reimbursement' END AS kind,
             m.description, m.occurred_on, m.account_id, m.signed_cents,
             a.name AS account_name, other.name AS other_account_name
      FROM auto_finance.cash_movements m
      JOIN auto_finance.accounts a ON a.workspace_id = m.workspace_id AND a.id = m.account_id
      LEFT JOIN auto_finance.accounts other ON other.workspace_id = m.workspace_id AND other.id = m.other_account_id
      LEFT JOIN auto_finance.split_settlements s ON s.workspace_id = m.workspace_id
        AND ((m.kind IN ('income', 'expense') AND s.entry_id = m.id) OR (m.kind = 'transfer' AND s.transfer_id = m.id))
      WHERE m.workspace_id = ${workspaceId}::uuid
        AND m.occurred_on BETWEEN ${filter.from}::date AND LEAST(${filter.to}::date, timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::date)
        AND (${filter.accountId ?? null}::uuid IS NULL OR m.account_id = ${filter.accountId ?? null}::uuid)
    ), page_rows AS (
      SELECT id, kind, description, to_char(occurred_on, 'YYYY-MM-DD') AS "occurredOn",
             account_id AS "accountId", account_name AS "accountName", other_account_name AS "otherAccountName",
             signed_cents::text AS "signedCents"
      FROM filtered ORDER BY occurred_on DESC, id DESC, kind, account_id
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    )
    SELECT count(*)::integer AS count, COALESCE(sum(signed_cents), 0)::text AS "netCents",
           COALESCE(sum(signed_cents) FILTER (WHERE kind = 'income'), 0)::text AS "incomeCents",
           COALESCE(-sum(signed_cents) FILTER (WHERE kind = 'expense'), 0)::text AS "expenseCents",
           COALESCE(-sum(signed_cents) FILTER (WHERE kind IN ('payment', 'payment_reversal')), 0)::text AS "paidCents",
           COALESCE(sum(signed_cents) FILTER (WHERE kind = 'transfer'), 0)::text AS "transferNetCents",
           COALESCE(sum(signed_cents) FILTER (WHERE kind = 'reimbursement'), 0)::text AS "reimbursementNetCents",
           COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r."occurredOn" DESC, r.id DESC, r.kind, r."accountId") FROM page_rows r), '[]') AS entries
    FROM filtered
  `
  return { ...report, page, pageSize }
}
