import { Prisma } from '../generated/prisma/client.ts'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { withFinancialLock } from './transaction.ts'

export interface InvoiceKey {
  cardId: string
  cycleMonth: string
}

interface DatedAmount {
  id: string
  occurredOn: string
  amountCents: number
}

export interface InstallmentInput extends DatedAmount {
  cardId: string
  description: string
  installmentCount: number
  firstCycle?: string
}

export interface PaymentInput extends DatedAmount, InvoiceKey { accountId: string }
export interface RefundInput extends DatedAmount, InvoiceKey { chargeId: string; source: InvoiceCharge['source'] }
export interface TransferInput extends DatedAmount { accountId: string; destinationId: string; description: string }
export interface ReversalInput { id: string; paymentId: string; occurredOn: string }

interface InvoiceTotals {
  cycleMonth: string
  cardId: string
  cardName: string
  holderName: string
  closingOn: string
  dueOn: string
  today: string
  chargeCents: string
  refundCents: string
  paidCents: string
}

export type InvoiceSummary = Omit<InvoiceTotals, 'today'> & {
  openCents: string
  creditCents: string
  closed: boolean
}

export interface InvoiceCharge {
  id: string
  source: 'purchase' | 'installment'
  description: string
  purchasedOn: string
  amountCents: string
  installmentNumber: number
  installmentCount: number
  availableRefundCents: string
}

export interface InvoiceDetail {
  charges: InvoiceCharge[]
  adjustments: {
    id: string
    kind: 'refund' | 'payment' | 'payment_reversal'
    amountCents: string
    occurredOn: string
    description: string
    accountName: string | null
    reversed: boolean
  }[]
}

export interface Invoices {
  summaries: InvoiceSummary[]
  detail: InvoiceDetail | null
}

export class FinancialInputError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message)
  }
}

const sqlDate = (date: string) => new Date(`${date}T00:00:00Z`)
const today = Prisma.sql`timezone('America/Sao_Paulo', CURRENT_TIMESTAMP)::date`

async function getTotals(transaction: Prisma.TransactionClient, workspaceId: string, from: string, to: string, cardId?: string, includeEmpty = false) {
  return transaction.$queryRaw<InvoiceTotals[]>`
    WITH charges AS (
      SELECT card_id, cycle_month, sum(amount_cents) AS amount
      FROM auto_finance.invoice_charges
      WHERE workspace_id = ${workspaceId}::uuid AND cycle_month BETWEEN ${from}::date AND ${to}::date
      GROUP BY card_id, cycle_month
    ), adjustments AS (
      SELECT card_id, cycle_month, sum(amount_cents) FILTER (WHERE kind = 'refund') AS refunded,
             sum(CASE kind WHEN 'payment' THEN amount_cents WHEN 'payment_reversal' THEN -amount_cents ELSE 0 END) AS paid
      FROM auto_finance.financial_adjustments
      WHERE workspace_id = ${workspaceId}::uuid AND cycle_month BETWEEN ${from}::date AND ${to}::date
      GROUP BY card_id, cycle_month
    ), cycles AS (
      SELECT card_id, cycle_month FROM charges
      UNION SELECT card_id, cycle_month FROM adjustments
      UNION SELECT id, ${from}::date FROM auto_finance.cards
        WHERE workspace_id = ${workspaceId}::uuid AND ${includeEmpty}::boolean
    )
    SELECT c.id AS "cardId", c.name AS "cardName", h.name AS "holderName",
           to_char(cycles.cycle_month, 'YYYY-MM-DD') AS "cycleMonth",
           to_char(dates.closing_on, 'YYYY-MM-DD') AS "closingOn",
           to_char(CASE WHEN dates.due_this_month > dates.closing_on THEN dates.due_this_month
             ELSE dates.next_month + LEAST(c.due_day, dates.month_after - dates.next_month) - 1 END, 'YYYY-MM-DD') AS "dueOn",
           to_char(${today}, 'YYYY-MM-DD') AS today, COALESCE(ch.amount, 0)::text AS "chargeCents",
           COALESCE(a.refunded, 0)::text AS "refundCents", COALESCE(a.paid, 0)::text AS "paidCents"
    FROM auto_finance.cards c
    JOIN cycles ON cycles.card_id = c.id
    JOIN auto_finance.holders h ON h.workspace_id = c.workspace_id AND h.id = c.holder_id
    CROSS JOIN LATERAL (
      SELECT m.start_on + LEAST(c.closing_day, m.next_month - m.start_on) - 1 AS closing_on,
             m.start_on + LEAST(c.due_day, m.next_month - m.start_on) - 1 AS due_this_month,
             m.next_month, m.month_after
      FROM (SELECT cycles.cycle_month AS start_on,
                   (cycles.cycle_month + interval '1 month')::date AS next_month,
                   (cycles.cycle_month + interval '2 months')::date AS month_after) m
    ) dates
    LEFT JOIN charges ch ON ch.card_id = c.id AND ch.cycle_month = cycles.cycle_month
    LEFT JOIN adjustments a ON a.card_id = c.id AND a.cycle_month = cycles.cycle_month
    WHERE c.workspace_id = ${workspaceId}::uuid AND (${cardId ?? null}::uuid IS NULL OR c.id = ${cardId ?? null}::uuid)
    ORDER BY c.name, c.id, cycles.cycle_month DESC
  `
}

function invoiceBalance(row: Pick<InvoiceTotals, 'chargeCents' | 'refundCents' | 'paidCents'>): bigint {
  return BigInt(row.chargeCents) - BigInt(row.refundCents) - BigInt(row.paidCents)
}

async function getCharges(transaction: Prisma.TransactionClient, workspaceId: string, key: InvoiceKey, chargeId?: string, source?: InvoiceCharge['source']) {
  return transaction.$queryRaw<InvoiceCharge[]>`
    SELECT ch.id, ch.source, ch.description, to_char(ch.purchased_on, 'YYYY-MM-DD') AS "purchasedOn",
           ch.amount_cents::text AS "amountCents", ch.installment_number AS "installmentNumber",
           ch.installment_count AS "installmentCount",
           (ch.amount_cents - COALESCE(refunds.amount, 0))::text AS "availableRefundCents"
    FROM auto_finance.invoice_charges ch
    LEFT JOIN LATERAL (
      SELECT sum(a.amount_cents) AS amount FROM auto_finance.financial_adjustments a
      WHERE a.workspace_id = ch.workspace_id AND a.card_id = ch.card_id AND a.cycle_month = ch.cycle_month
        AND a.kind = 'refund'
        AND ((ch.source = 'purchase' AND a.purchase_id = ch.id) OR (ch.source = 'installment' AND a.plan_id = ch.id))
    ) refunds ON true
    WHERE ch.workspace_id = ${workspaceId}::uuid AND ch.card_id = ${key.cardId}::uuid AND ch.cycle_month = ${key.cycleMonth}::date
      AND (${chargeId ?? null}::uuid IS NULL OR ch.id = ${chargeId ?? null}::uuid)
      AND (${source ?? null}::text IS NULL OR ch.source = ${source ?? null}::text)
    ORDER BY ch.purchased_on, ch.id, ch.source
  `
}

function toSummary({ today, ...row }: InvoiceTotals): InvoiceSummary {
  const balance = invoiceBalance(row)
  return { ...row, closed: row.closingOn < today, openCents: String(balance > 0n ? balance : 0n),
    creditCents: String(balance < 0n ? -balance : 0n) }
}

export async function listInvoiceCycles(prisma: PrismaClient, workspaceId: string, from: string, to: string) {
  return (await getTotals(prisma, workspaceId, from, to)).map(toSummary)
}

export async function getInvoices(prisma: PrismaClient, workspaceId: string, cycleMonth: string, cardId?: string): Promise<Invoices> {
  return prisma.$transaction(async (transaction) => {
    const totals = await getTotals(transaction, workspaceId, cycleMonth, cycleMonth, undefined, true)
    const summaries = totals.map(toSummary)
    if (!cardId) return { summaries, detail: null }
    if (!summaries.some((row) => row.cardId === cardId)) throw new FinancialInputError('Cartão não encontrado neste espaço.', 404)
    const charges = await getCharges(transaction, workspaceId, { cardId, cycleMonth })
    const rows = await transaction.financialAdjustment.findMany({
      where: { workspaceId, cardId, cycleMonth: sqlDate(cycleMonth) },
      orderBy: [{ occurredOn: 'asc' }, { id: 'asc' }],
      select: { id: true, kind: true, amountCents: true, occurredOn: true, description: true,
        account: { select: { name: true } }, reversal: { select: { id: true } } },
    })
    const adjustments = rows.flatMap<InvoiceDetail['adjustments'][number]>(({ kind, amountCents, occurredOn, account, reversal, ...row }) => {
      if (kind !== 'refund' && kind !== 'payment' && kind !== 'payment_reversal') return []
      return [{ ...row, kind, amountCents: amountCents.toString(), occurredOn: occurredOn.toISOString().slice(0, 10),
        accountName: account?.name ?? null, reversed: reversal !== null }]
    })
    return { summaries, detail: { charges, adjustments } }
  }, { isolationLevel: 'RepeatableRead' })
}

export async function addInstallment(prisma: PrismaClient, workspaceId: string, input: InstallmentInput): Promise<boolean> {
  if (input.amountCents < input.installmentCount) throw new FinancialInputError('Cada parcela precisa ter pelo menos um centavo.')
  const [cycle] = await prisma.$queryRaw<{ cycle: string }[]>`
    SELECT to_char(auto_finance.purchase_cycle(${input.occurredOn}::date, closing_day), 'YYYY-MM-DD') AS cycle
    FROM auto_finance.cards WHERE workspace_id = ${workspaceId}::uuid AND id = ${input.cardId}::uuid
  `
  if (!cycle) throw new FinancialInputError('Selecione um cartão deste espaço financeiro.')
  const firstCycle = input.firstCycle ?? cycle.cycle
  if (firstCycle < cycle.cycle) throw new FinancialInputError('A primeira parcela precisa estar no ciclo da compra ou em um ciclo posterior.')
  const { count } = await prisma.cardInstallmentPlan.createMany({
    data: {
      workspaceId, id: input.id, cardId: input.cardId, description: input.description.trim(),
      totalCents: BigInt(input.amountCents), installmentCount: input.installmentCount,
      purchasedOn: sqlDate(input.occurredOn), firstCycle: sqlDate(firstCycle),
    },
    skipDuplicates: true,
  })
  return count === 1
}

function createAdjustment(transaction: Prisma.TransactionClient, workspaceId: string, input: Omit<Prisma.FinancialAdjustmentCreateManyInput, 'workspaceId'>) {
  return transaction.financialAdjustment.createMany({ data: { ...input, workspaceId }, skipDuplicates: true })
    .then(({ count }) => count === 1)
}

async function serializeAdjustment(prisma: PrismaClient, workspaceId: string, input: { id: string; occurredOn: string },
  write: (transaction: Prisma.TransactionClient) => Promise<boolean>): Promise<boolean> {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    if (await transaction.financialAdjustment.findUnique({ where: { workspaceId_id: { workspaceId, id: input.id } }, select: { id: true } })) return false
    const [{ currentDate }] = await transaction.$queryRaw<[{ currentDate: string }]>`SELECT to_char(${today}, 'YYYY-MM-DD') AS "currentDate"`
    if (input.occurredOn > currentDate) throw new FinancialInputError('Informe uma data de movimentação até hoje.')
    return write(transaction)
  })
}

export function addPayment(prisma: PrismaClient, workspaceId: string, input: PaymentInput): Promise<boolean> {
  return serializeAdjustment(prisma, workspaceId, input, async (transaction) => {
    const [row] = await getTotals(transaction, workspaceId, input.cycleMonth, input.cycleMonth, input.cardId)
    if (!row || BigInt(input.amountCents) > invoiceBalance(row)) {
      throw new FinancialInputError('O pagamento precisa caber no valor em aberto da fatura.')
    }
    return createAdjustment(transaction, workspaceId, {
      id: input.id, kind: 'payment', description: 'Pagamento de fatura', amountCents: BigInt(input.amountCents),
      occurredOn: sqlDate(input.occurredOn), cardId: input.cardId, cycleMonth: sqlDate(input.cycleMonth), accountId: input.accountId,
    })
  })
}

export function addRefund(prisma: PrismaClient, workspaceId: string, input: RefundInput): Promise<boolean> {
  return serializeAdjustment(prisma, workspaceId, input, async (transaction) => {
    const [charge] = await getCharges(transaction, workspaceId, input, input.chargeId, input.source)
    if (!charge || input.occurredOn < charge.purchasedOn || BigInt(input.amountCents) > BigInt(charge.availableRefundCents)) {
      throw new FinancialInputError('Confira a compra, a data e o valor disponível para estorno.')
    }
    return createAdjustment(transaction, workspaceId, {
      id: input.id, kind: 'refund', description: `Estorno · ${charge.description.slice(0, 148)}`,
      amountCents: BigInt(input.amountCents), occurredOn: sqlDate(input.occurredOn),
      cardId: input.cardId, cycleMonth: sqlDate(input.cycleMonth),
      purchaseId: input.source === 'purchase' ? input.chargeId : null,
      planId: input.source === 'installment' ? input.chargeId : null,
    })
  })
}

export function reversePayment(prisma: PrismaClient, workspaceId: string, input: ReversalInput): Promise<boolean> {
  return serializeAdjustment(prisma, workspaceId, input, async (transaction) => {
    const payment = await transaction.financialAdjustment.findUnique({
      where: { workspaceId_id: { workspaceId, id: input.paymentId } },
      select: { kind: true, amountCents: true, occurredOn: true, cardId: true, cycleMonth: true, accountId: true,
        reversal: { select: { id: true } } },
    })
    if (payment?.kind !== 'payment') throw new FinancialInputError('Pagamento não encontrado neste espaço.', 404)
    if (payment.reversal) return false
    if (sqlDate(input.occurredOn) < payment.occurredOn) throw new FinancialInputError('A data do estorno precisa ser igual ou posterior à do pagamento.')
    return createAdjustment(transaction, workspaceId, {
      id: input.id, paymentId: input.paymentId, kind: 'payment_reversal', description: 'Estorno de pagamento',
      amountCents: payment.amountCents, occurredOn: sqlDate(input.occurredOn),
      cardId: payment.cardId, cycleMonth: payment.cycleMonth, accountId: payment.accountId,
    })
  })
}

export function addTransfer(prisma: PrismaClient, workspaceId: string, input: TransferInput): Promise<boolean> {
  if (input.accountId.toLowerCase() === input.destinationId.toLowerCase()) throw new FinancialInputError('Escolha contas diferentes para a transferência.')
  return serializeAdjustment(prisma, workspaceId, input, (transaction) => createAdjustment(transaction, workspaceId, {
    id: input.id, kind: 'transfer', description: input.description.trim(), amountCents: BigInt(input.amountCents),
    occurredOn: sqlDate(input.occurredOn), accountId: input.accountId, destinationId: input.destinationId,
  }))
}
