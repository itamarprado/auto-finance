import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'
import { apportionCents } from '../ledger/split-math.ts'
import { FinancialInputError } from './invoices.ts'
import { withFinancialLock } from './transaction.ts'

type SplitOrigin = { source: 'entry' | 'plan'; id: string }
type ReceiptOrigin = { source: 'entry' | 'transfer'; id: string }
type People = { fromHolderId: string; toHolderId: string }
type ListFilter = { page?: number; search?: string }
export type SplitInput = {
  id: string
  origin: SplitOrigin
  payerId: string
  mode: 'equal' | 'fixed'
  shares: { holderId: string; amountCents?: number }[]
}
export type SettlementInput = People & {
  id: string
  origin: ReceiptOrigin
  allocations: { splitId: string; holderId: string; amountCents: number }[]
}
export type SplitSource = SplitOrigin & {
  description: string
  amountCents: string
  occurredOn: string
  holderId: string
  instrument: string
}
export type ReceiptSource = ReceiptOrigin & Omit<SplitSource, 'source' | 'id' | 'holderId'>

const pageSize = 25

export async function listSplitSources(prisma: PrismaClient, workspaceId: string, { page = 1, search = '' }: ListFilter) {
  const rows = await prisma.$queryRaw<SplitSource[]>`
    WITH available AS (
      SELECT e.id, 'entry' AS source, e.description, e.amount_cents, e.occurred_on,
             COALESCE(a.holder_id, c.holder_id) AS holder_id, COALESCE(a.name, c.name) AS instrument
      FROM auto_finance.ledger_entries e
      LEFT JOIN auto_finance.accounts a ON (a.workspace_id, a.id) = (e.workspace_id, e.account_id)
      LEFT JOIN auto_finance.cards c ON (c.workspace_id, c.id) = (e.workspace_id, e.card_id)
      WHERE e.workspace_id = ${workspaceId}::uuid AND e.kind IN ('expense', 'purchase')
        AND NOT EXISTS (SELECT 1 FROM auto_finance.expense_splits s WHERE (s.workspace_id, s.entry_id) = (e.workspace_id, e.id))
        AND NOT EXISTS (SELECT 1 FROM auto_finance.split_settlements r WHERE (r.workspace_id, r.entry_id) = (e.workspace_id, e.id))
      UNION ALL
      SELECT p.id, 'plan', p.description, p.total_cents, p.purchased_on, c.holder_id, c.name
      FROM auto_finance.card_installment_plans p
      JOIN auto_finance.cards c ON (c.workspace_id, c.id) = (p.workspace_id, p.card_id)
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND NOT EXISTS (SELECT 1 FROM auto_finance.expense_splits s WHERE (s.workspace_id, s.plan_id) = (p.workspace_id, p.id))
    )
    SELECT id, source, description, instrument, amount_cents::text AS "amountCents", holder_id AS "holderId",
           to_char(occurred_on, 'YYYY-MM-DD') AS "occurredOn"
    FROM available WHERE strpos(lower(description), lower(${search})) > 0 OR ${search} = ''
    ORDER BY occurred_on DESC, id, source
    LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}
  `
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize }
}

async function receiptSources(prisma: Prisma.TransactionClient, workspaceId: string, people: People,
  { page = 1, search = '', origin }: ListFilter & { origin?: ReceiptOrigin }) {
  return prisma.$queryRaw<ReceiptSource[]>`
    WITH available AS (
      SELECT e.id, 'entry' AS source, e.description, e.amount_cents, e.occurred_on, a.name AS instrument
      FROM auto_finance.ledger_entries e
      JOIN auto_finance.accounts a ON (a.workspace_id, a.id) = (e.workspace_id, e.account_id)
      WHERE e.workspace_id = ${workspaceId}::uuid
        AND ((e.kind = 'expense' AND a.holder_id = ${people.fromHolderId}::uuid)
          OR (e.kind = 'income' AND a.holder_id = ${people.toHolderId}::uuid))
        AND NOT EXISTS (SELECT 1 FROM auto_finance.expense_splits s WHERE (s.workspace_id, s.entry_id) = (e.workspace_id, e.id))
        AND NOT EXISTS (SELECT 1 FROM auto_finance.split_settlements r WHERE (r.workspace_id, r.entry_id) = (e.workspace_id, e.id))
      UNION ALL
      SELECT t.id, 'transfer', t.description, t.amount_cents, t.occurred_on, debit.name || ' → ' || credit.name
      FROM auto_finance.financial_adjustments t
      JOIN auto_finance.accounts debit ON (debit.workspace_id, debit.id) = (t.workspace_id, t.account_id)
      JOIN auto_finance.accounts credit ON (credit.workspace_id, credit.id) = (t.workspace_id, t.destination_id)
      WHERE t.workspace_id = ${workspaceId}::uuid AND t.kind = 'transfer'
        AND debit.holder_id = ${people.fromHolderId}::uuid AND credit.holder_id = ${people.toHolderId}::uuid
        AND NOT EXISTS (SELECT 1 FROM auto_finance.split_settlements r WHERE (r.workspace_id, r.transfer_id) = (t.workspace_id, t.id))
    )
    SELECT id, source, description, instrument, amount_cents::text AS "amountCents", to_char(occurred_on, 'YYYY-MM-DD') AS "occurredOn"
    FROM available
    WHERE occurred_on <= timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::date
      AND (strpos(lower(description), lower(${search})) > 0 OR ${search} = '')
      AND (${origin?.id ?? null}::uuid IS NULL OR (id = ${origin?.id ?? null}::uuid AND source = ${origin?.source ?? null}::text))
    ORDER BY occurred_on DESC, id, source
    LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}
  `
}

export async function listReceiptSources(prisma: PrismaClient, workspaceId: string, filter: People & ListFilter) {
  const rows = await receiptSources(prisma, workspaceId, filter, filter)
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize }
}

const refunds = { where: { kind: 'refund' }, select: { amountCents: true } }
const splitInclude = {
  payer: { select: { name: true } },
  entry: { select: { id: true, description: true, amountCents: true, occurredOn: true, financialAdjustments: refunds } },
  plan: { select: { id: true, description: true, totalCents: true, purchasedOn: true, refunds } },
  shares: { orderBy: { holderId: 'asc' }, include: {
    holder: { select: { name: true } },
    allocations: { orderBy: { settlement: { createdAt: 'asc' } }, include: { settlement: { select: {
      id: true, fromHolderId: true, toHolderId: true,
      entry: { select: { occurredOn: true, description: true } },
      transfer: { select: { occurredOn: true, description: true } },
    } } } },
  } },
} satisfies Prisma.ExpenseSplitInclude

function summarize(split: Prisma.ExpenseSplitGetPayload<{ include: typeof splitInclude }>) {
  const origin = split.entry ?? split.plan!
  const original = 'amountCents' in origin ? origin.amountCents : origin.totalCents
  const occurredOn = 'occurredOn' in origin ? origin.occurredOn : origin.purchasedOn
  const adjustments = 'financialAdjustments' in origin ? origin.financialAdjustments : origin.refunds
  const net = original - adjustments.reduce((sum, refund) => sum + refund.amountCents, 0n)
  const responsibilities = apportionCents(net, split.shares.map((share) => share.amountCents))
  return {
    id: split.id, payerId: split.payerId, payerName: split.payer.name, description: origin.description,
    occurredOn: occurredOn.toISOString().slice(0, 10), originalCents: original.toString(), netCents: net.toString(),
    shares: split.shares.map((share, index) => {
      const paid = share.allocations.reduce((sum, item) => sum + (item.settlement.fromHolderId === share.holderId
        ? item.amountCents : -item.amountCents), 0n)
      return {
        holderId: share.holderId, holderName: share.holder.name, originalCents: share.amountCents.toString(),
        responsibilityCents: responsibilities[index].toString(),
        openCents: (share.holderId === split.payerId ? 0n : responsibilities[index] - paid).toString(),
        settlements: share.allocations.map(({ amountCents, settlement }) => {
          const movement = settlement.entry ?? settlement.transfer!
          return { id: settlement.id, amountCents: amountCents.toString(), description: movement.description,
            occurredOn: movement.occurredOn.toISOString().slice(0, 10), compensating: settlement.toHolderId === share.holderId }
        }),
      }
    }),
  }
}

export type SplitSummary = ReturnType<typeof summarize>

export async function listSplits(prisma: PrismaClient, workspaceId: string, page = 1) {
  return prisma.$transaction(async (transaction) => {
    const rows = await transaction.expenseSplit.findMany({
      where: { workspaceId }, include: splitInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize + 1,
    })
    return { items: rows.slice(0, pageSize).map(summarize), hasNext: rows.length > pageSize }
  }, { isolationLevel: 'RepeatableRead' })
}

export function addSplit(prisma: PrismaClient, workspaceId: string, input: SplitInput) {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    const { origin, mode } = input
    const payerId = input.payerId.toLowerCase()
    const shares = input.shares.map((share) => ({ ...share, holderId: share.holderId.toLowerCase() }))
      .sort((a, b) => a.holderId.localeCompare(b.holderId))
    if (new Set(shares.map((share) => share.holderId)).size !== shares.length) {
      throw new FinancialInputError('Selecione cada participante uma única vez.')
    }
    const where = { workspaceId, id: origin.id }
    const movement = origin.source === 'entry'
      ? await transaction.ledgerEntry.findFirst({ where: { ...where, kind: { in: ['expense', 'purchase'] }, splitSettlement: null },
        select: { amountCents: true, expenseSplit: { select: { id: true } } } })
      : await transaction.cardInstallmentPlan.findUnique({ where: { workspaceId_id: where },
        select: { totalCents: true, expenseSplit: { select: { id: true } } } })
    if (!movement) throw new FinancialInputError('Selecione uma despesa disponível neste espaço.')
    if (movement.expenseSplit || await transaction.expenseSplit.findUnique({ where: { workspaceId_id: { workspaceId, id: input.id } } })) return false
    const total = 'amountCents' in movement ? movement.amountCents : movement.totalCents
    const amounts = mode === 'equal' ? apportionCents(total, shares.map(() => 1n))
      : shares.map((share) => BigInt(share.amountCents ?? 0))
    if (amounts.some((amount) => amount < 1n) || amounts.reduce((sum, amount) => sum + amount, 0n) !== total) {
      throw new FinancialInputError('As partes devem ser positivas e somar o valor da despesa.')
    }
    if (await transaction.holder.count({ where: { workspaceId, id: { in: shares.map((share) => share.holderId) } } }) !== shares.length
      || !await transaction.holder.findUnique({ where: { workspaceId_id: { workspaceId, id: payerId } }, select: { id: true } })) {
      throw new FinancialInputError('Selecione pessoas cadastradas neste espaço.')
    }
    await transaction.expenseSplit.create({ data: {
      workspaceId, id: input.id, payerId, entryId: origin.source === 'entry' ? origin.id : null,
      planId: origin.source === 'plan' ? origin.id : null,
    } })
    await transaction.splitShare.createMany({ data: shares.map(({ holderId }, index) => ({
      workspaceId, splitId: input.id, holderId, amountCents: amounts[index],
    })) })
    return true
  })
}

export function addSettlement(prisma: PrismaClient, workspaceId: string, input: SettlementInput) {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    const fromHolderId = input.fromHolderId.toLowerCase()
    const toHolderId = input.toHolderId.toLowerCase()
    if (fromHolderId === toHolderId) throw new FinancialInputError('Selecione pessoas diferentes para o acerto.')
    const allocations = input.allocations.map((item) => ({ ...item, holderId: item.holderId.toLowerCase(), splitId: item.splitId.toLowerCase() }))
    if (new Set(allocations.map((item) => `${item.splitId}:${item.holderId}`)).size !== allocations.length) {
      throw new FinancialInputError('Cada parte só pode receber um valor deste movimento.')
    }
    const originKey = input.origin.source === 'entry' ? { entryId: input.origin.id } : { transferId: input.origin.id }
    if (await transaction.splitSettlement.findFirst({ where: { workspaceId, OR: [{ id: input.id }, originKey] }, select: { id: true } })) return false
    const [receipt] = await receiptSources(transaction, workspaceId, { fromHolderId, toHolderId }, { origin: input.origin })
    if (!receipt || allocations.reduce((sum, item) => sum + BigInt(item.amountCents), 0n) !== BigInt(receipt.amountCents)) {
      throw new FinancialInputError('Escolha um movimento disponível e distribua seu valor integral entre os rateios.')
    }
    const splits = new Map((await transaction.expenseSplit.findMany({
      where: { workspaceId, id: { in: allocations.map((item) => item.splitId) } }, include: splitInclude,
    })).map((split) => [split.id, summarize(split)]))
    for (const allocation of allocations) {
      const split = splits.get(allocation.splitId)
      const share = split?.shares.find((item) => item.holderId === allocation.holderId)
      if (!split || !share || receipt.occurredOn < split.occurredOn) {
        throw new FinancialInputError('O movimento deve ter data igual ou posterior à despesa de cada rateio.')
      }
      const settlesDebt = share.holderId === fromHolderId && split.payerId === toHolderId
      const returnsExcess = share.holderId === toHolderId && split.payerId === fromHolderId
      const outstanding = BigInt(share.openCents)
      const available = settlesDebt ? outstanding : returnsExcess ? -outstanding : 0n
      if (BigInt(allocation.amountCents) > available) throw new FinancialInputError('O valor deve caber no saldo em aberto entre as duas pessoas.')
    }
    await transaction.splitSettlement.create({ data: { workspaceId, id: input.id, fromHolderId, toHolderId, ...originKey } })
    await transaction.splitSettlementAllocation.createMany({ data: allocations.map((item) => ({
      workspaceId, settlementId: input.id, splitId: item.splitId, holderId: item.holderId, amountCents: BigInt(item.amountCents),
    })) })
    return true
  })
}
