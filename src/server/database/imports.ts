import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'
import { parseImportCsv, privacyText } from '../ledger/import-csv.ts'
import type { CsvMovement, CsvRow, ImportTarget } from '../ledger/import-csv.ts'
import { FinancialInputError } from './invoices.ts'

export interface ImportInput extends ImportTarget { csv: string }
export interface ImportCandidate {
  id: string
  source: 'entry' | 'payment'
  description: string
}
export type ImportPreviewRow = { line: number; issue: string }
  | (Omit<CsvMovement, 'externalDigest'> & { candidates: ImportCandidate[]; duplicate: boolean })
export interface ImportPreview { digest: string; repeated: boolean; rows: ImportPreviewRow[] }
export interface ImportChoice { line: number; action: 'create' | 'link' | 'skip'; reference?: string; acknowledged?: boolean }
export interface ImportConfirmation extends ImportInput { digest: string; choices: ImportChoice[] }
export interface ImportSummary {
  id: string
  targetName: string
  targetKind: ImportTarget['targetKind']
  createdAt: string
  created: number
  linked: number
  skipped: number
  rejected: number
  duplicates: number
}

const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`)
const targetColumns = ({ targetKind, targetId }: ImportTarget) => targetKind === 'account'
  ? { accountId: targetId, cardId: null } : { accountId: null, cardId: targetId }

async function validateTarget(prisma: Prisma.TransactionClient, workspaceId: string, input: ImportTarget) {
  const filter = { where: { workspaceId_id: { workspaceId, id: input.targetId } }, select: { id: true } } as const
  const destination = input.targetKind === 'account' ? await prisma.account.findUnique(filter) : await prisma.card.findUnique(filter)
  if (!destination) throw new FinancialInputError('Selecione uma conta ou cartão deste espaço financeiro.')
}

function batchByDigest(prisma: Prisma.TransactionClient, workspaceId: string, target: ImportTarget, digest: string) {
  return prisma.importBatch.findFirst({ where: { workspaceId, ...targetColumns(target), digest }, select: { id: true } })
}

type ReviewedRow =
  | Extract<CsvRow, { issue: string }>
  | (CsvMovement & { candidates: ImportCandidate[]; duplicate: boolean })

async function reviewRows(prisma: Prisma.TransactionClient, workspaceId: string, target: ImportTarget, rows: CsvRow[]): Promise<ReviewedRow[]> {
  const movements = rows.filter((row): row is CsvMovement => !('issue' in row))
  if (!movements.length) return rows.filter((row) => 'issue' in row)
  const dates = [...new Set(movements.map((row) => row.occurredOn))].map(dateOnly)
  const amounts = [...new Set(movements.map((row) => row.amountCents))].map(BigInt)
  const external = movements.flatMap(({ externalDigest }) => externalDigest ? [externalDigest] : [])
  const destination = targetColumns(target)
  const [entries, payments, previous] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { workspaceId, ...destination, occurredOn: { in: dates }, amountCents: { in: amounts } },
      orderBy: [{ occurredOn: 'desc' }, { id: 'asc' }],
      select: { id: true, kind: true, amountCents: true, occurredOn: true, description: true },
    }),
    target.targetKind === 'account' ? prisma.financialAdjustment.findMany({
      where: { workspaceId, accountId: target.targetId, kind: 'payment', reversal: { is: null },
        occurredOn: { in: dates }, amountCents: { in: amounts } },
      orderBy: { id: 'asc' },
      select: { id: true, amountCents: true, occurredOn: true, description: true, card: { select: { name: true } } },
    }) : [],
    external.length ? prisma.importRow.findMany({
      where: { workspaceId, externalDigest: { in: external }, batch: destination },
      select: { externalDigest: true },
    }) : [],
  ])

  const grouped = new Map<string, ImportCandidate[]>()
  function add(kind: string, occurredOn: Date, amount: bigint, candidate: ImportCandidate) {
    const key = `${kind}:${occurredOn.toISOString().slice(0, 10)}:${amount}`
    const group = grouped.get(key)
    if (group) group.push(candidate)
    else grouped.set(key, [candidate])
  }
  for (const entry of entries) {
    add(entry.kind, entry.occurredOn, entry.amountCents, { id: entry.id, source: 'entry', description: privacyText(entry.description) })
  }
  for (const payment of payments) {
    const candidate = { id: payment.id, source: 'payment' as const, description: privacyText(`Pagamento de fatura · ${payment.card?.name ?? 'Cartão'}`) }
    add('payment', payment.occurredOn, payment.amountCents, candidate)
    add('expense', payment.occurredOn, payment.amountCents, candidate)
  }
  const alreadyImported = new Set(previous.map(({ externalDigest }) => externalDigest))
  return rows.map((row) => 'issue' in row ? row : {
    ...row, duplicate: row.externalDigest !== null && alreadyImported.has(row.externalDigest),
    candidates: (grouped.get(`${row.kind}:${row.occurredOn}:${row.amountCents}`) ?? []).slice(0, 12),
  })
}

export async function previewImport(prisma: PrismaClient, workspaceId: string, input: ImportInput): Promise<ImportPreview> {
  const file = parseImportCsv(input.csv, input.targetKind)
  await validateTarget(prisma, workspaceId, input)
  if (await batchByDigest(prisma, workspaceId, input, file.digest)) return { digest: file.digest, repeated: true, rows: [] }
  const rows = (await reviewRows(prisma, workspaceId, input, file.rows)).map((row) => {
    if ('issue' in row) return row
    const { externalDigest, ...preview } = row
    void externalDigest
    return preview
  })
  return { digest: file.digest, repeated: false, rows }
}

export async function importHistory(prisma: Prisma.TransactionClient, workspaceId: string, batchId?: string): Promise<ImportSummary[]> {
  return prisma.$queryRaw<ImportSummary[]>`
    WITH batches AS (
      SELECT b.id, b.workspace_id, b.account_id, b.card_id, b.created_at
      FROM auto_finance.import_batches b
      WHERE b.workspace_id = ${workspaceId}::uuid AND (${batchId ?? null}::uuid IS NULL OR b.id = ${batchId ?? null}::uuid)
      ORDER BY b.created_at DESC, b.id DESC LIMIT 30
    )
    SELECT b.id, COALESCE(a.name, c.name) AS "targetName",
      CASE WHEN b.account_id IS NOT NULL THEN 'account' ELSE 'card' END AS "targetKind",
      to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      (count(*) FILTER (WHERE r.status = 'created'))::integer AS created,
      (count(*) FILTER (WHERE r.status = 'linked'))::integer AS linked,
      (count(*) FILTER (WHERE r.status = 'skipped'))::integer AS skipped,
      (count(*) FILTER (WHERE r.status = 'rejected'))::integer AS rejected,
      (count(*) FILTER (WHERE r.status = 'duplicate'))::integer AS duplicates
    FROM batches b
    LEFT JOIN auto_finance.accounts a ON a.workspace_id = b.workspace_id AND a.id = b.account_id
    LEFT JOIN auto_finance.cards c ON c.workspace_id = b.workspace_id AND c.id = b.card_id
    LEFT JOIN auto_finance.import_rows r ON r.workspace_id = b.workspace_id AND r.batch_id = b.id
    GROUP BY b.id, b.account_id, b.created_at, a.name, c.name
    ORDER BY b.created_at DESC, b.id DESC
  `
}

function resolveRows(workspaceId: string, batchId: string, target: ImportTarget, review: ReviewedRow[], choices: ImportChoice[]) {
  const decisions = new Map(choices.map((choice) => [choice.line, choice]))
  if (decisions.size !== choices.length || choices.some(({ line }) => line < 2 || line >= review.length + 2)) {
    throw new FinancialInputError('Revise as decisões do lote.')
  }
  const entries: Prisma.LedgerEntryCreateManyInput[] = []
  const referenced = new Set<string>()
  const rows = review.map<Prisma.ImportRowCreateManyInput>((row) => {
    const base = { workspaceId, batchId, line: row.line }
    if ('issue' in row) return { ...base, status: 'rejected' }
    if (row.duplicate) return { ...base, status: 'duplicate' }
    const choice = decisions.get(row.line)
    if (!choice) throw new FinancialInputError(`Revise o registro ${row.line}.`)
    if (choice.action === 'skip') return { ...base, status: 'skipped' }
    if (choice.action === 'link') {
      const candidate = row.candidates.find((candidate) => `${candidate.source}:${candidate.id}` === choice.reference)
      if (!candidate || !choice.reference || referenced.has(choice.reference)) {
        throw new FinancialInputError(`Revise o vínculo do registro ${row.line}. Cada movimentação pode ser vinculada uma vez no lote.`, 409)
      }
      referenced.add(choice.reference)
      return { ...base, status: 'linked', externalDigest: row.externalDigest,
        entryId: candidate.source === 'entry' ? candidate.id : null,
        adjustmentId: candidate.source === 'payment' ? candidate.id : null }
    }
    if (row.kind === 'payment') {
      throw new FinancialInputError(`Registre o pagamento na tela de faturas antes de vincular o registro ${row.line}.`)
    }
    if (row.candidates.length && !choice.acknowledged) {
      throw new FinancialInputError(`Foi encontrada uma coincidência para o registro ${row.line}. Gere a prévia novamente.`, 409)
    }
    const id = randomUUID()
    entries.push({ workspaceId, id, ...targetColumns(target), kind: row.kind,
      amountCents: BigInt(row.amountCents), description: row.description, occurredOn: dateOnly(row.occurredOn),
      category: row.category, tags: row.tags })
    return { ...base, status: 'created', externalDigest: row.externalDigest, entryId: id }
  })
  return { entries, rows }
}

export async function confirmImport(prisma: PrismaClient, workspaceId: string, input: ImportConfirmation) {
  const file = parseImportCsv(input.csv, input.targetKind)
  if (input.digest !== file.digest) throw new FinancialInputError('O arquivo mudou. Gere a prévia novamente.', 409)
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${workspaceId.toLowerCase()}, 634028))`
    await validateTarget(transaction, workspaceId, input)
    const existing = await batchByDigest(transaction, workspaceId, input, file.digest)
    if (existing) return { repeated: true, batch: (await importHistory(transaction, workspaceId, existing.id))[0] }
    const id = randomUUID()
    const { entries, rows } = resolveRows(workspaceId, id, input, await reviewRows(transaction, workspaceId, input, file.rows), input.choices)
    await transaction.importBatch.create({ data: { workspaceId, id, ...targetColumns(input), digest: file.digest }, select: { id: true } })
    if (entries.length) await transaction.ledgerEntry.createMany({ data: entries })
    await transaction.importRow.createMany({ data: rows })
    return { repeated: false, batch: (await importHistory(transaction, workspaceId, id))[0] }
  }, { isolationLevel: 'ReadCommitted', timeout: 10_000 })
}
