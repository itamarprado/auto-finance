import { createHash } from 'node:crypto'
import Papa from 'papaparse'
import { FinancialInputError } from '../database/invoices.ts'

export const maxCsvBytes = 512 * 1024
export const maxCsvRows = 500
const columns = ['data', 'descricao', 'valor', 'tipo', 'id_externo', 'categoria', 'tags'] as const
type Column = typeof columns[number]

export type CsvKind = 'income' | 'expense' | 'purchase' | 'payment'
export type ImportTarget = { targetKind: 'account' | 'card'; targetId: string }

export interface CsvMovement {
  line: number
  occurredOn: string
  description: string
  amountCents: number
  kind: CsvKind
  externalDigest: string | null
  category: string | null
  tags: string[]
}

export type CsvRow = CsvMovement | { line: number; issue: string }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const normalized = (value: string) => value.trim().normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase()

export function privacyText(text: string): string {
  return text.replace(/\p{Cc}/gu, ' ')
    .replace(/\b\d(?:[ .-]?\d){10,18}\b/g, '[dado ocultado]')
    .trim()
}

export function classification(category: string, tags: string[]) {
  const cleaned = tags.map(privacyText).filter(Boolean)
  const unique = [...new Map(cleaned.map((tag) => [tag.toLowerCase(), tag])).values()]
  const name = privacyText(category)
  if (name.length > 80 || unique.length > 12 || unique.some((tag) => tag.length > 40)) {
    throw new FinancialInputError('Use categoria de até 80 caracteres e até 12 tags de 40 caracteres.')
  }
  return { category: name || null, tags: unique }
}

function civilDate(value: string): string {
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
  const date = br ? `${br[3]}-${br[2]}-${br[1]}` : value
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Data inválida. Use AAAA-MM-DD ou DD/MM/AAAA.')
  }
  return date
}

function cents(value: string): number {
  if (!/^[+-]?(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+,\d{1,2})$/.test(value)) {
    throw new Error('Valor inválido. Use até duas casas decimais.')
  }
  const decimal = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value
  const [whole, fraction = ''] = decimal.replace(/^[+-]/, '').split('.')
  const amount = Number(whole + fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('O valor precisa ser diferente de zero e caber em centavos.')
  return value.startsWith('-') ? -amount : amount
}

const kinds: Record<string, CsvKind> = {
  receita: 'income', income: 'income', despesa: 'expense', expense: 'expense',
  compra: 'purchase', purchase: 'purchase', pagamento_fatura: 'payment', payment: 'payment',
}

export function parseImportCsv(csv: string, targetKind: ImportTarget['targetKind']): { digest: string; rows: CsvRow[] } {
  if (Buffer.byteLength(csv, 'utf8') > maxCsvBytes) throw new FinancialInputError('O CSV excede 512 KB.')
  const text = csv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimitersToGuess: [';', ','], preview: maxCsvRows + 2 })
  const [header = [], ...lines] = parsed.data
  if (parsed.errors.some((error) => error.code !== 'UndetectableDelimiter')) throw new FinancialInputError('CSV malformado. Confira delimitadores e aspas.')
  if (!lines.length || lines.length > maxCsvRows) throw new FinancialInputError('Use de 1 a 500 registros por arquivo.')
  const headings = header.map(normalized)
  const positions = new Map(columns.map((column) => [column, headings.indexOf(column)]))
  if (columns.some((column) => headings.indexOf(column) !== headings.lastIndexOf(column))
    || ['data', 'descricao', 'valor'].some((column) => positions.get(column as Column) === -1)) {
    throw new FinancialInputError('O cabeçalho precisa conter data, descricao e valor, sem colunas reconhecidas repetidas.')
  }

  const seen = new Set<string>()
  const rows = lines.map<CsvRow>((cells, index) => {
    const line = index + 2
    const read = (column: Column) => cells[positions.get(column) ?? -1]?.trim() ?? ''
    try {
      if (cells.length !== header.length) throw new Error('O registro tem um número de colunas diferente do cabeçalho.')
      const occurredOn = civilDate(read('data'))
      const description = privacyText(read('descricao'))
      if (!description || description.length > 160) throw new Error('A descrição deve ter de 1 a 160 caracteres.')
      const amount = cents(read('valor'))
      const value = normalized(read('tipo')).replace(/\s+/g, '_')
      const kind = value ? (Object.hasOwn(kinds, value) ? kinds[value] : undefined)
        : targetKind === 'card' ? 'purchase' : amount < 0 ? 'expense' : 'income'
      if (!kind || (targetKind === 'card' ? kind !== 'purchase' : kind === 'purchase')) {
        throw new Error('O tipo é inválido para a conta ou o cartão selecionado.')
      }
      const external = read('id_externo')
      const externalDigest = external ? digest(external) : null
      if (externalDigest && seen.has(externalDigest)) throw new Error('Identificador externo repetido neste arquivo.')
      const labels = classification(read('categoria'), read('tags').split('|'))
      if (externalDigest) seen.add(externalDigest)
      return { line, occurredOn, description, amountCents: Math.abs(amount), kind, externalDigest, ...labels }
    } catch (error) {
      return { line, issue: error instanceof Error ? error.message : 'Não foi possível interpretar o registro.' }
    }
  })
  return { digest: digest(text.trimEnd()), rows }
}

export function csvCell(value: string): string {
  const safe = /^[\p{Cc}\p{Cf}\p{Z}]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
