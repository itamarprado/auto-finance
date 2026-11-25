import type { LedgerEntry, Prisma, PrismaClient, RecurrenceOccurrence, RecurrenceVersion, RecurringSeries } from '../generated/prisma/client.ts'
import { privacyText } from '../ledger/import-csv.ts'
import { addDays, dateText, monthEnd, nextScheduled, sqlDate, todayInBrasilia } from '../ledger/recurrence-calendar.ts'
import type { Cadence } from '../ledger/recurrence-calendar.ts'
import { FinancialInputError } from './invoices.ts'
import { withFinancialLock } from './transaction.ts'

type Kind = 'subscription' | 'expense' | 'income'
type Instrument = { accountId: string | null; cardId: string | null }
type TermsInput = Instrument & { amountCents: number; endsOn: string | null; active: boolean }
type ForecastSettings = { groupName: string | null; variableAmount: boolean }
export type ForecastSettingsInput = ForecastSettings & { id: string }
export type SeriesInput = TermsInput & Partial<ForecastSettings> & { id: string; name: string; cadence: Cadence; kind: Kind; startsOn: string }
export type VersionInput = TermsInput & { id: string; effectiveOn: string }
export type OccurrenceInput = { id: string; scheduledOn: string; action: 'adjust' | 'skip' | 'restore' | 'link' | 'confirm' | 'unconfirm';
  expectedOn?: string; amountCents?: number; entryId?: string; confirmedCents?: number }

type Actual = Pick<LedgerEntry, 'id' | 'occurredOn' | 'description' | 'amountCents' | 'accountId' | 'cardId'>
type SeriesCalendar = {
  series: RecurringSeries
  versions: RecurrenceVersion[]
  exceptions: Map<string, RecurrenceOccurrence>
  actuals: Map<string, Actual>
}

const actualFields = { id: true, occurredOn: true, description: true, amountCents: true, accountId: true, cardId: true } as const
const ceiling = '9999-12-31'

function partition<T extends { seriesId: string }>(rows: T[]) {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(row.seriesId)
    if (group) group.push(row)
    else groups.set(row.seriesId, [row])
  }
  return groups
}

function versionAt(versions: RecurrenceVersion[], date: string) {
  for (let index = versions.length - 1; index >= 0; index--) {
    if (dateText(versions[index].effectiveOn) <= date) return versions[index]
  }
  return undefined
}

function during(version: RecurrenceVersion, date: string) {
  return version.active && (!version.endsOn || date <= dateText(version.endsOn))
}

function occurrence(calendar: SeriesCalendar, scheduledOn: string) {
  const version = versionAt(calendar.versions, scheduledOn)
  if (!version || !during(version, scheduledOn)) return undefined
  const exception = calendar.exceptions.get(scheduledOn)
  const actual = exception?.entryId ? calendar.actuals.get(exception.entryId) : undefined
  const expectedOn = exception?.expectedOn ? dateText(exception.expectedOn) : scheduledOn
  return {
    seriesId: calendar.series.id, name: calendar.series.name, kind: calendar.series.kind as Kind,
    scheduledOn, expectedOn, on: actual ? dateText(actual.occurredOn) : expectedOn,
    plannedCents: (exception?.amountCents ?? version.amountCents).toString(),
    confirmedCents: exception?.confirmedCents?.toString() ?? null,
    actualCents: actual?.amountCents.toString() ?? null, entryId: actual?.id ?? null,
    description: actual?.description ?? null, skipped: exception?.skipped ?? false,
    accountId: actual ? actual.accountId : version.accountId, cardId: actual ? actual.cardId : version.cardId,
  }
}

export type Occurrence = NonNullable<ReturnType<typeof occurrence>>

function nextOccurrence(calendar: SeriesCalendar, today: string) {
  const { series, versions, exceptions } = calendar
  const startsOn = dateText(series.startsOn)
  const cadence = series.cadence as Cadence
  const choices: Occurrence[] = []
  for (const [scheduledOn, exception] of exceptions) {
    if (!exception.expectedOn || dateText(exception.expectedOn) < today) continue
    const moved = occurrence(calendar, scheduledOn)
    if (moved && !moved.skipped && !moved.entryId) choices.push(moved)
  }
  for (const [index, version] of versions.entries()) {
    if (!version.active) continue
    const effective = dateText(version.effectiveOn)
    const following = versions[index + 1]
    const end = version.endsOn ? dateText(version.endsOn) : ceiling
    let scheduled = nextScheduled(startsOn, cadence, effective > today ? effective : today)
    while (scheduled && scheduled <= end && (!following || scheduled < dateText(following.effectiveOn))) {
      if (!exceptions.has(scheduled)) {
        const next = occurrence(calendar, scheduled)
        if (next) choices.push(next)
        break
      }
      const adjusted = occurrence(calendar, scheduled)
      if (adjusted && adjusted.on >= today && !adjusted.skipped && !adjusted.entryId) {
        choices.push(adjusted)
        if (adjusted.on <= scheduled) break
      }
      scheduled = nextScheduled(startsOn, cadence, addDays(scheduled, 1))
    }
  }
  return choices.sort((a, b) => a.on.localeCompare(b.on))[0] ?? null
}

export async function recurrenceReport(prisma: PrismaClient, workspaceId: string, month: string, view: 'agenda' | 'forecast' = 'agenda') {
  const last = monthEnd(month)
  const today = todayInBrasilia()
  const now = sqlDate(today)
  const from = sqlDate(month)
  const to = sqlDate(last)
  return prisma.$transaction(async (transaction) => {
    const series = await transaction.recurringSeries.findMany({
      where: { workspaceId, kind: view === 'forecast' ? { in: ['expense', 'subscription'] } : undefined },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    const versions = partition(await transaction.recurrenceVersion.findMany({
      where: { workspaceId }, orderBy: { effectiveOn: 'asc' },
    }))
    const exceptions = await transaction.recurrenceOccurrence.findMany({ where: { workspaceId, OR: [
      { scheduledOn: { gte: from, lte: to } }, { expectedOn: { gte: from, lte: to } },
      { scheduledOn: { gte: now } }, { expectedOn: { gte: now } },
      { settledOn: { gte: from, lte: to } },
    ] } })
    const actualIds = exceptions.flatMap((item) => item.entryId ? [item.entryId] : [])
    const actuals = new Map((await transaction.ledgerEntry.findMany({
      where: { workspaceId, id: { in: actualIds } }, select: actualFields,
    })).map((actual) => [actual.id, actual]))
    const exceptionsBySeries = partition(exceptions)
    const occurrences: Occurrence[] = []
    const overview = series.map((record) => {
      const calendar: SeriesCalendar = {
        series: record, versions: versions.get(record.id) ?? [], actuals,
        exceptions: new Map((exceptionsBySeries.get(record.id) ?? []).map((item) => [dateText(item.scheduledOn), item])),
      }
      const startsOn = dateText(record.startsOn)
      const cadence = record.cadence as Cadence
      const keys = new Set(calendar.exceptions.keys())
      let scheduled = nextScheduled(startsOn, cadence, month)
      while (scheduled && scheduled <= last) {
        keys.add(scheduled)
        scheduled = nextScheduled(startsOn, cadence, addDays(scheduled, 1))
      }
      for (const key of keys) {
        const row = occurrence(calendar, key)
        if (!row || (view === 'forecast' && row.skipped)) continue
        const date = view === 'forecast' ? row.expectedOn : row.on
        if (date >= month && date <= last) occurrences.push(row)
      }
      const next = nextOccurrence(calendar, today)
      const terms = versionAt(calendar.versions, today) ?? calendar.versions[0]
      return {
        id: record.id, name: record.name, kind: record.kind as Kind, cadence, startsOn, next,
        groupName: record.groupName, variableAmount: record.variableAmount,
        changeOn: nextScheduled(startsOn, cadence, today) ?? null,
        amountCents: terms.amountCents.toString(), accountId: terms.accountId, cardId: terms.cardId,
        endsOn: terms.endsOn ? dateText(terms.endsOn) : null,
      }
    })
    const sortDate = view === 'forecast' ? 'expectedOn' : 'on'
    occurrences.sort((a, b) => a[sortDate].localeCompare(b[sortDate]) || a.name.localeCompare(b.name) || a.scheduledOn.localeCompare(b.scheduledOn))
    return { series: overview, occurrences }
  }, { isolationLevel: 'RepeatableRead' })
}

export type RecurrenceReport = Awaited<ReturnType<typeof recurrenceReport>>

function validateTerms(kind: string, date: string, terms: TermsInput) {
  if ((terms.accountId && terms.cardId) || (kind === 'income' && terms.cardId)) {
    throw new FinancialInputError('Escolha um meio compatível com o tipo de recorrência.')
  }
  if (terms.endsOn && terms.endsOn < date) throw new FinancialInputError('A data final deve ser igual ou posterior ao início da vigência.')
  return { amountCents: BigInt(terms.amountCents), endsOn: terms.endsOn ? sqlDate(terms.endsOn) : null,
    accountId: terms.accountId, cardId: terms.cardId, active: terms.active }
}

function forecastSettings(input: Partial<ForecastSettings>) {
  const groupName = privacyText(input.groupName ?? '')
  if (groupName.length > 80) throw new FinancialInputError('Informe um grupo de até 80 caracteres.')
  return { groupName: groupName || null, variableAmount: input.variableAmount ?? false }
}

export async function configureForecast(prisma: PrismaClient, workspaceId: string, input: ForecastSettingsInput) {
  const { count } = await prisma.recurringSeries.updateMany({
    where: { workspaceId, id: input.id, kind: { in: ['expense', 'subscription'] } }, data: forecastSettings(input),
  })
  if (!count) throw new FinancialInputError('Despesa recorrente não encontrada neste espaço.', 404)
  return true
}

export function addRecurrence(prisma: PrismaClient, workspaceId: string, input: SeriesInput) {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    const name = privacyText(input.name.trim())
    if (!name || name.length > 120) throw new FinancialInputError('Informe um nome de até 120 caracteres.')
    const terms = validateTerms(input.kind, input.startsOn, input)
    const { count } = await transaction.recurringSeries.createMany({
      data: { workspaceId, id: input.id, name, kind: input.kind, cadence: input.cadence, startsOn: sqlDate(input.startsOn), ...forecastSettings(input) },
      skipDuplicates: true,
    })
    if (count === 0) return false
    await transaction.recurrenceVersion.create({ data: { workspaceId, seriesId: input.id, effectiveOn: sqlDate(input.startsOn), ...terms } })
    return true
  })
}

async function seriesFor(transaction: Prisma.TransactionClient, workspaceId: string, seriesId: string, scheduledOn: string) {
  const series = await transaction.recurringSeries.findUnique({ where: { workspaceId_id: { workspaceId, id: seriesId } } })
  if (!series) throw new FinancialInputError('Recorrência não encontrada neste espaço.', 404)
  if (nextScheduled(dateText(series.startsOn), series.cadence as Cadence, scheduledOn) !== scheduledOn) {
    throw new FinancialInputError('Escolha uma data da agenda original da recorrência.')
  }
  return series
}

export function changeRecurrence(prisma: PrismaClient, workspaceId: string, input: VersionInput) {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    const series = await seriesFor(transaction, workspaceId, input.id, input.effectiveOn)
    const effectiveOn = sqlDate(input.effectiveOn)
    const key = { workspaceId, seriesId: series.id, effectiveOn }
    if (input.effectiveOn < todayInBrasilia()) throw new FinancialInputError('Alterações de série começam hoje ou em uma ocorrência futura.')
    const subsequent = await transaction.recurrenceVersion.findFirst({
      where: { workspaceId, seriesId: series.id, effectiveOn: { gt: effectiveOn } }, orderBy: { effectiveOn: 'asc' },
    })
    const linked = await transaction.recurrenceOccurrence.findFirst({ where: {
      workspaceId, seriesId: series.id, OR: [{ entryId: { not: null } }, { confirmedCents: { not: null } }],
      scheduledOn: { gte: effectiveOn, lt: subsequent?.effectiveOn },
    } })
    if (linked) throw new FinancialInputError('Há ocorrências confirmadas ou conciliadas nesta vigência. Escolha uma data posterior.', 409)
    const terms = validateTerms(series.kind, input.effectiveOn, input)
    await transaction.recurrenceVersion.upsert({
      where: { workspaceId_seriesId_effectiveOn: key }, create: { ...key, ...terms }, update: terms,
    })
    return true
  })
}

async function occurrenceContext(transaction: Prisma.TransactionClient, workspaceId: string, id: string, scheduledOn: string) {
  const series = await seriesFor(transaction, workspaceId, id, scheduledOn)
  const key = { workspaceId, seriesId: id, scheduledOn: sqlDate(scheduledOn) }
  const version = await transaction.recurrenceVersion.findFirst({
    where: { workspaceId, seriesId: id, effectiveOn: { lte: key.scheduledOn } }, orderBy: { effectiveOn: 'desc' },
  })
  if (!version || !during(version, scheduledOn)) throw new FinancialInputError('A recorrência está encerrada ou suspensa nesta data.')
  const exception = await transaction.recurrenceOccurrence.findUnique({ where: { workspaceId_seriesId_scheduledOn: key } })
  return { series, version, key, exception }
}

function eligibleEntry(workspaceId: string, kind: string, instrument: Instrument, entryId?: string): Prisma.LedgerEntryWhereInput {
  return {
    workspaceId, id: entryId, occurredOn: { lte: sqlDate(todayInBrasilia()) },
    kind: kind === 'income' ? 'income' : { in: ['expense', 'purchase'] },
    accountId: instrument.accountId ?? undefined, cardId: instrument.cardId ?? undefined,
    splitSettlement: null, recurrenceOccurrence: null,
  }
}

export async function recurrenceCandidates(prisma: PrismaClient, workspaceId: string, id: string, scheduledOn: string, search?: string) {
  const { series, version, exception } = await occurrenceContext(prisma, workspaceId, id, scheduledOn)
  if (exception?.skipped || exception?.entryId) return []
  const rows = await prisma.ledgerEntry.findMany({
    where: { ...eligibleEntry(workspaceId, series.kind, version), amountCents: exception?.confirmedCents ?? undefined,
      description: search ? { contains: search, mode: 'insensitive' } : undefined },
    select: actualFields, orderBy: [{ occurredOn: 'desc' }, { id: 'asc' }], take: 30,
  })
  return rows.map((row) => ({ ...row, amountCents: row.amountCents.toString(), occurredOn: dateText(row.occurredOn) }))
}

export type RecurrenceCandidate = Awaited<ReturnType<typeof recurrenceCandidates>>[number]

export function writeOccurrence(prisma: PrismaClient, workspaceId: string, input: OccurrenceInput) {
  return withFinancialLock(prisma, workspaceId, async (transaction) => {
    const { series, version, key, exception } = await occurrenceContext(transaction, workspaceId, input.id, input.scheduledOn)
    if (exception?.entryId) throw new FinancialInputError('A ocorrência já foi conciliada.', 409)
    const isConfirmation = input.action === 'confirm' || input.action === 'unconfirm'
    if (exception?.confirmedCents != null && input.action !== 'link' && !isConfirmation) {
      throw new FinancialInputError('Reabra a previsão antes de alterar uma conta confirmada.', 409)
    }
    let patch: Pick<Prisma.RecurrenceOccurrenceUncheckedCreateInput, 'expectedOn' | 'amountCents' | 'skipped' | 'entryId' | 'settledOn' | 'confirmedCents'>
    if (input.action === 'link') {
      if (!input.entryId || exception?.skipped) throw new FinancialInputError('Escolha um lançamento disponível para conciliar.')
      const entry = await transaction.ledgerEntry.findFirst({
        where: { ...eligibleEntry(workspaceId, series.kind, version, input.entryId), amountCents: exception?.confirmedCents ?? undefined },
        select: { id: true, occurredOn: true },
      })
      if (!entry) throw new FinancialInputError('Escolha um lançamento disponível que corresponda ao meio de cobrança e ao valor confirmado, quando houver.')
      patch = { entryId: entry.id, settledOn: entry.occurredOn }
    } else if (isConfirmation) {
      if (series.kind === 'income' || exception?.skipped) throw new FinancialInputError('Selecione uma despesa prevista que esteja ativa.')
      if (input.action === 'confirm' && input.confirmedCents === undefined) throw new FinancialInputError('Informe o valor da conta.')
      patch = { confirmedCents: input.action === 'unconfirm' ? null : BigInt(input.confirmedCents!) }
    } else if (input.action === 'adjust') {
      if (!input.expectedOn || input.amountCents === undefined) throw new FinancialInputError('Informe a data e o valor previstos.')
      patch = { skipped: false, expectedOn: sqlDate(input.expectedOn), amountCents: BigInt(input.amountCents) }
    } else {
      patch = { skipped: input.action === 'skip', expectedOn: null, amountCents: null }
    }
    await transaction.recurrenceOccurrence.upsert({
      where: { workspaceId_seriesId_scheduledOn: key }, create: { ...key, ...patch }, update: patch,
    })
    return true
  })
}
