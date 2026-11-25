import { useState } from 'react'
import { dateInBrasilia } from '../domain/date.ts'
import { confirmedAmount, expenseTotals } from '../domain/expense-forecast.ts'
import { formatBrlCents, parseBrlCents } from '../domain/money.ts'
import type { LedgerCatalog } from '../server/database/ledger.ts'
import type { Occurrence, RecurrenceReport } from '../server/database/recurrences.ts'
import { useReport } from './financial-view.tsx'
import { field, RecordDialog } from './ledger-form.tsx'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'
import { ForecastFields, instrumentName, moneyInput, OccurrenceDialog, SeriesDialog } from './recurrences-view.tsx'

type Series = RecurrenceReport['series'][number]
type Action = { kind: 'create' } | { kind: 'settings'; series: Series }
  | { kind: 'adjust' | 'link' | 'confirm' | 'unconfirm'; row: Occurrence }

interface Props {
  url: string
  catalog: LedgerCatalog
  revision: number
  saved: () => void
  expireSession: () => void
}

const groupKey = (name: string) => name.normalize('NFC').toLocaleLowerCase('pt-BR')

function describeDifference(cents: bigint) {
  if (cents === 0n) return 'Sem diferença'
  return cents > 0n ? `${formatBrlCents(cents)} acima` : `${formatBrlCents(-cents)} abaixo`
}

function ForecastTotals({ rows }: { rows: Occurrence[] }) {
  const { planned, confirmed, pending, total, difference } = expenseTotals(rows)
  return <dl className="financial-values cash-values">
    <div><dt>Estimativa do mês</dt><dd>{formatBrlCents(planned)}</dd></div>
    <div><dt>Confirmado</dt><dd>{formatBrlCents(confirmed)}</dd></div>
    <div><dt>Ainda estimado</dt><dd>{formatBrlCents(pending)}</dd></div>
    <div><dt>Total atualizado</dt><dd>{formatBrlCents(total)}</dd></div>
    <div><dt>Variação em relação à estimativa</dt><dd>{describeDifference(difference)}</dd></div>
  </dl>
}

function ForecastDialog({ action, props, close, write, month }: {
  action: Action; props: Props; close: () => void; write: (resource: string, record: object) => Promise<void>; month: string
}) {
  if (action.kind === 'create') return <SeriesDialog forecast initialDate={`${month}-01`} props={props} close={close} write={write} />
  if (action.kind === 'settings') {
    return <RecordDialog title="Organizar despesa" dismiss={close} save={async (fields) => {
      await write('expense-forecast-settings', { id: action.series.id, groupName: field(fields, 'groupName') || null,
        variableAmount: field(fields, 'amountType') === 'variable' })
    }}>
      <p className="financial-context">{action.series.name}</p>
      <ForecastFields series={action.series} />
    </RecordDialog>
  }
  const { kind, row } = action
  if (kind === 'adjust' || kind === 'link') return <OccurrenceDialog action={{ kind, row }} props={props} close={close} write={write} />
  return <RecordDialog title={kind === 'confirm' ? 'Confirmar valor da conta' : 'Reabrir previsão'} dismiss={close} save={async (fields) => {
    const cents = kind === 'confirm' ? parseBrlCents(field(fields, 'amount')) : undefined
    if (cents !== undefined && cents < 0) throw new Error('Informe um valor igual ou maior que zero.')
    await write('recurrence-occurrences', { id: row.seriesId, scheduledOn: row.scheduledOn, action: kind, confirmedCents: cents })
  }}>
    <p className="financial-context">{row.name} · {formatDate(row.expectedOn)} · estimativa {formatBrlCents(row.plannedCents)}</p>
    {kind === 'confirm'
      ? <label>Valor confirmado em reais<input name="amount" inputMode="decimal" required defaultValue={moneyInput(row.confirmedCents ?? row.plannedCents)} /></label>
      : <p>A despesa voltará a usar a estimativa deste mês.</p>}
  </RecordDialog>
}

export function ExpenseForecastView(props: Props) {
  const [month, setMonth] = useState(() => dateInBrasilia().slice(0, 7))
  const [filter, setFilter] = useState('')
  const [action, setAction] = useState<Action>()
  const { data, feedback } = useReport<RecurrenceReport>(`${props.url}/expense-forecast?month=${month}-01`, props.revision, props.expireSession)
  const seriesById = new Map(data?.series.map((series) => [series.id, series]))
  const groupMap = new Map<string, string>()
  for (const series of seriesById.values()) {
    if (series.groupName) groupMap.set(`group:${groupKey(series.groupName)}`, series.groupName)
  }
  const group = filter === 'ungrouped' || groupMap.has(filter) ? filter : ''
  const rows = data?.occurrences.filter((row) => {
    const name = seriesById.get(row.seriesId)?.groupName
    return !group || group === (name ? `group:${groupKey(name)}` : 'ungrouped')
  }) ?? []
  const close = () => setAction(undefined)

  async function write(resource: string, record: object) {
    try {
      await ledgerRequest(`${props.url}/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })
      close()
      props.saved()
    } catch (error) {
      if (error instanceof LedgerError && error.status === 401) props.expireSession()
      throw error
    }
  }

  return <>
    <section className="ledger-surface financial-controls" aria-label="Filtros de previsão">
      <label>Mês de referência<input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value) }} /></label>
      <label>Grupo<select value={group} onChange={(event) => setFilter(event.target.value)}>
        <option value="">Todos os gastos</option><option value="ungrouped">Sem grupo</option>
        {[...groupMap.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
          .map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></label>
      <button type="button" className="ledger-primary" onClick={() => setAction({ kind: 'create' })}>Nova despesa recorrente</button>
    </section>
    {feedback}
    {data && <section className="ledger-surface" aria-label="Resumo da previsão de gastos">
      <div className="ledger-section-heading"><h2>Previsão do mês</h2></div>
      <ForecastTotals rows={rows} />
      {rows.length === 0 && <p className="ledger-empty">Nenhuma despesa recorrente para este mês e grupo.</p>}
      <ul className="financial-rows">
        {rows.map((row) => {
          const series = seriesById.get(row.seriesId)
          const confirmed = confirmedAmount(row)
          return <li key={`${row.seriesId}:${row.scheduledOn}`}>
            <div>
              <strong>{row.name}</strong>
              <small>{formatDate(row.expectedOn)} · {series?.variableAmount ? 'Valor variável' : 'Valor fixo'} · {instrumentName(row, props.catalog)}
                {series?.groupName && ` · ${series.groupName}`}</small>
              <small>{row.entryId ? `Vinculada ao extrato em ${formatDate(row.on)}` : confirmed !== null ? 'Valor confirmado manualmente' : 'Estimada'}</small>
              {confirmed !== null && <small>Estimativa {formatBrlCents(row.plannedCents)} · {describeDifference(BigInt(confirmed) - BigInt(row.plannedCents))}</small>}
            </div>
            <strong>{formatBrlCents(confirmed ?? row.plannedCents)}</strong>
            <div className="recurrence-actions">
              {series && <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'settings', series })}>Organizar</button>}
              {!row.entryId && <>
                {confirmed === null
                  ? <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'adjust', row })}>Ajustar estimativa</button>
                  : <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'unconfirm', row })}>Reabrir previsão</button>}
                <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'confirm', row })}>
                  {confirmed === null ? 'Confirmar valor' : 'Corrigir valor'}
                </button>
                <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'link', row })}>Vincular ao extrato</button>
              </>}
            </div>
          </li>
        })}
      </ul>
    </section>}
    {action && <ForecastDialog action={action} props={props} close={close} write={write} month={month} />}
  </>
}
