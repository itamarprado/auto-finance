import type { PrismaClient } from '../generated/prisma/client.ts'
import { addDays, dateText, monthEnd } from '../ledger/recurrence-calendar.ts'
import { listInvoiceCycles } from './invoices.ts'
import { readRecurrenceReport } from './recurrences.ts'

type ProjectionItem = {
  key: string
  on: string
  dueOn?: string
  accountId: string | null
  description: string
  source: 'opening' | 'recorded' | 'invoice' | 'recurrence' | 'card_recurrence'
  cents: string
}

// Match purchase_cycle and the invoice due-date rule, including short months.
export function estimatedCardDueOn(on: string, closingDay: number, dueDay: number) {
  const month = `${on.slice(0, 7)}-01`
  const cycle = Number(on.slice(8)) > closingDay ? addDays(monthEnd(month), 1) : month
  const daysInCycle = Number(monthEnd(cycle).slice(8))
  if (Math.min(dueDay, daysInCycle) > Math.min(closingDay, daysInCycle)) {
    return addDays(cycle, Math.min(dueDay, daysInCycle) - 1)
  }
  const next = addDays(monthEnd(cycle), 1)
  return addDays(next, Math.min(dueDay, Number(monthEnd(next).slice(8))) - 1)
}

export function projectionDays(initial: bigint, items: ProjectionItem[]) {
  const days = new Map<string, ProjectionItem[]>()
  for (const item of items) {
    const day = days.get(item.on)
    if (day) day.push(item)
    else days.set(item.on, [item])
  }
  let balance = initial
  const timeline = [...days].sort(([left], [right]) => left.localeCompare(right)).map(([on, movements]) => {
    const change = movements.reduce((sum, item) => sum + BigInt(item.cents), 0n)
    balance += change
    return { on, changeCents: change.toString(), balanceCents: balance.toString(), movements }
  })
  return { timeline, projectedCents: balance.toString() }
}

export function balanceProjection(prisma: PrismaClient, workspaceId: string, today: string, to: string) {
  return prisma.$transaction(async (transaction) => {
    const accounts = await transaction.account.findMany({
      where: { workspaceId }, orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, openingDate: true, openingBalanceCents: true, holder: { select: { name: true } } },
    })
    const cards = new Map((await transaction.card.findMany({
      where: { workspaceId }, select: { id: true, name: true, paymentAccountId: true, closingDay: true, dueDay: true },
    })).map((card) => [card.id, card]))
    const balances = new Map((await transaction.$queryRaw<{ accountId: string; cents: string }[]>`
      SELECT m.account_id AS "accountId", sum(m.signed_cents)::text AS cents
      FROM auto_finance.cash_movements m
      JOIN auto_finance.accounts a ON a.workspace_id = m.workspace_id AND a.id = m.account_id
      WHERE m.workspace_id = ${workspaceId}::uuid AND m.occurred_on BETWEEN a.opening_date AND ${today}::date
      GROUP BY m.account_id
    `).map((row) => [row.accountId, BigInt(row.cents)]))
    const future = await transaction.$queryRaw<ProjectionItem[]>`
      SELECT concat(m.kind, ':', m.id, ':', m.account_id) AS key, m.account_id AS "accountId",
             to_char(m.occurred_on, 'YYYY-MM-DD') AS "on", m.description,
             m.signed_cents::text AS cents, 'recorded' AS source
      FROM auto_finance.cash_movements m
      JOIN auto_finance.accounts a ON a.workspace_id = m.workspace_id AND a.id = m.account_id
      WHERE m.workspace_id = ${workspaceId}::uuid AND m.occurred_on > ${today}::date
        AND m.occurred_on BETWEEN a.opening_date AND ${to}::date
      ORDER BY m.occurred_on, m.kind, m.id, m.account_id
    `
    const items = [...future]
    const lastMonth = `${to.slice(0, 7)}-01`
    const invoices = await listInvoiceCycles(transaction, workspaceId, '0001-01-01', lastMonth)
    for (const invoice of invoices) {
      if (invoice.openCents === '0' || invoice.dueOn > to) continue
      items.push({
        key: `invoice:${invoice.cardId}:${invoice.cycleMonth}`, source: 'invoice',
        accountId: cards.get(invoice.cardId)?.paymentAccountId ?? null,
        on: invoice.dueOn < today ? today : invoice.dueOn, dueOn: invoice.dueOn,
        cents: (-BigInt(invoice.openCents)).toString(),
        description: `Fatura de ${invoice.cardName} · ${invoice.holderName}`,
      })
    }
    // A charge after closing can reach the due date two months later.
    const firstMonth = `${addDays(`${today.slice(0, 7)}-01`, -32).slice(0, 7)}-01`
    for (let month = firstMonth; month <= lastMonth; month = addDays(monthEnd(month), 1)) {
      const { occurrences } = await readRecurrenceReport(transaction, workspaceId, month, 'agenda', today)
      for (const row of occurrences) {
        if (row.skipped || row.entryId || row.on > to) continue
        const card = row.cardId ? cards.get(row.cardId) : undefined
        const on = card ? estimatedCardDueOn(row.on, card.closingDay, card.dueDay) : row.on
        const cents = BigInt(row.confirmedCents ?? row.plannedCents)
        if (on < today || on > to || cents === 0n) continue
        items.push({
          key: `recurrence:${row.seriesId}:${row.scheduledOn}`, on,
          accountId: row.cardId ? card?.paymentAccountId ?? null : row.accountId,
          description: card ? `${row.name} · ${card.name}` : row.name,
          source: row.cardId ? 'card_recurrence' : 'recurrence',
          cents: (row.kind === 'income' ? cents : -cents).toString(),
        })
      }
    }
    const openingDates = new Map(accounts.map((account) => [account.id, dateText(account.openingDate)]))
    const unassigned: ProjectionItem[] = []
    const byAccount = new Map<string, ProjectionItem[]>()
    for (const item of items) {
      const opening = item.accountId && openingDates.get(item.accountId)
      if (!item.accountId || !opening || item.on < opening) {
        unassigned.push(item)
        continue
      }
      const list = byAccount.get(item.accountId)
      if (list) list.push(item)
      else byAccount.set(item.accountId, [item])
    }
    return {
      today, to,
      unassigned: unassigned.sort((a, b) => a.on.localeCompare(b.on)),
      accounts: accounts.map((account) => {
        const openingOn = dateText(account.openingDate)
        const movements = byAccount.get(account.id) ?? []
        const initial = openingOn <= today ? account.openingBalanceCents + (balances.get(account.id) ?? 0n) : 0n
        if (openingOn > today && openingOn <= to) {
          movements.unshift({ key: `opening:${account.id}`, on: openingOn, accountId: account.id,
            description: 'Saldo de abertura da conta', source: 'opening', cents: account.openingBalanceCents.toString() })
        }
        return { id: account.id, name: account.name, holderName: account.holder.name, openingOn,
          initialCents: initial.toString(), ...projectionDays(initial, movements) }
      }),
    }
  }, { isolationLevel: 'RepeatableRead' })
}

export type BalanceProjection = Awaited<ReturnType<typeof balanceProjection>>
