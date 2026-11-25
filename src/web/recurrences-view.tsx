import { useState } from 'react'
import { dateInBrasilia } from '../domain/date.ts'
import { formatBrlCents, parseBrlCents } from '../domain/money.ts'
import type { LedgerCatalog } from '../server/database/ledger.ts'
import type { Occurrence, RecurrenceCandidate, RecurrenceReport } from '../server/database/recurrences.ts'
import { useReport } from './financial-view.tsx'
import { field, RecordDialog } from './ledger-form.tsx'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'

type Series = RecurrenceReport['series'][number]
type Target = Pick<Series, 'accountId' | 'cardId'>
type Action = { kind: 'create' } | { kind: 'series'; series: Series }
  | { kind: 'adjust' | 'skip' | 'restore' | 'link'; row: Occurrence }

interface Props {
  url: string
  catalog: LedgerCatalog
  revision: number
  saved: () => void
  expireSession: () => void
}

const kindLabels = { subscription: 'Assinatura', expense: 'Despesa recorrente', income: 'Receita recorrente' }
const cadenceLabels = { weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' }

function cardLabel(card: LedgerCatalog['cards'][number], catalog: LedgerCatalog) {
  const holder = catalog.holders.find((person) => person.id === card.holderId)?.name
  return [card.name, holder, card.lastFour && `•••• ${card.lastFour}`].filter(Boolean).join(' · ')
}

function instrumentName(target: Target, catalog: LedgerCatalog) {
  const card = catalog.cards.find((item) => item.id === target.cardId)
  if (card) return cardLabel(card, catalog)
  return catalog.accounts.find((item) => item.id === target.accountId)?.name ?? 'Meio de cobrança a definir'
}

function moneyInput(cents: string) {
  const value = BigInt(cents)
  return `${value / 100n},${String(value % 100n).padStart(2, '0')}`
}

function amount(fields: FormData) {
  const cents = parseBrlCents(field(fields, 'amount'))
  if (cents <= 0) throw new Error('Informe um valor maior que zero.')
  return cents
}

function readTarget(fields: FormData): Target {
  const [kind, id] = field(fields, 'instrument').split(':')
  return { accountId: kind === 'account' ? id : null, cardId: kind === 'card' ? id : null }
}

function SeriesDialog({ series, props, close, write }: {
  series?: Series; props: Props; close: () => void; write: (resource: string, record: object) => Promise<void>
}) {
  const [kind, setKind] = useState<Series['kind']>(series?.kind ?? 'subscription')
  const [instrument, setInstrument] = useState(series?.cardId ? `card:${series.cardId}` : series?.accountId ? `account:${series.accountId}` : '')
  const start = series?.changeOn ?? dateInBrasilia()
  return <RecordDialog title={series ? 'Alterar próximas ocorrências' : 'Nova recorrência'} dismiss={close} save={async (fields, id) => {
    const terms = { amountCents: amount(fields), endsOn: field(fields, 'endsOn') || null,
      active: field(fields, 'status') !== 'paused', ...readTarget(fields) }
    if (series) {
      await write('recurrence-versions', { ...terms, id: series.id, effectiveOn: field(fields, 'startsOn') })
    } else {
      await write('recurrences', { ...terms, id, kind, name: field(fields, 'name'), cadence: field(fields, 'cadence'), startsOn: field(fields, 'startsOn') })
    }
  }}>
    {series ? <p className="financial-context">{series.name} · {cadenceLabels[series.cadence]}. Escolha uma data da agenda original.</p>
      : <>
        <label>Nome<input name="name" maxLength={120} required /></label>
        <div className="ledger-fields">
          <label>Tipo<select name="kind" value={kind} onChange={(event) => {
            const selected = event.target.value as Series['kind']
            setKind(selected)
            if (selected === 'income' && instrument.startsWith('card:')) setInstrument('')
          }}>
            {Object.entries(kindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
          <label>Frequência<select name="cadence" defaultValue="monthly">
            {Object.entries(cadenceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select></label>
        </div>
      </>}
    <label>Meio de cobrança<select name="instrument" value={instrument} onChange={(event) => setInstrument(event.target.value)}>
      <option value="">A definir</option>
      {props.catalog.accounts.map((account) => <option key={account.id} value={`account:${account.id}`}>{account.name}</option>)}
      {kind !== 'income' && props.catalog.cards.map((card) => <option key={card.id} value={`card:${card.id}`}>{cardLabel(card, props.catalog)}</option>)}
    </select></label>
    <div className="ledger-fields">
      <label>Valor por ocorrência em reais<input name="amount" inputMode="decimal" defaultValue={series && moneyInput(series.amountCents)} required /></label>
      <label>{series ? 'Vigente a partir de' : 'Primeira ocorrência'}<input name="startsOn" type="date" min={series ? start : undefined}
        defaultValue={start} required /></label>
      <label>Data final (opcional)<input name="endsOn" type="date" defaultValue={series?.endsOn && series.endsOn >= start ? series.endsOn : ''} /></label>
      {series && <label>Situação<select name="status" defaultValue="active">
        <option value="active">Ativa</option><option value="paused">Suspensa a partir da data</option>
      </select></label>}
    </div>
  </RecordDialog>
}

function ActualPicker({ props, row }: { props: Props; row: Occurrence }) {
  const [search, setSearch] = useState('')
  const query = new URLSearchParams({ id: row.seriesId, scheduledOn: row.scheduledOn, search })
  const { data, feedback } = useReport<RecurrenceCandidate[]>(`${props.url}/recurrence-candidates?${query}`, props.revision, props.expireSession)
  return <>
    <label>Buscar lançamento por descrição<input value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} /></label>
    {feedback}
    <label>Lançamento efetivado<select name="entryId" key={search} defaultValue="" required>
      <option value="" disabled>Selecione</option>
      {data?.map((entry) => <option value={entry.id} key={entry.id}>{entry.description} · {instrumentName(entry, props.catalog)} · {formatDate(entry.occurredOn)} · {formatBrlCents(entry.amountCents)}</option>)}
    </select></label>
    {data && data.length === 0 && <p className="financial-context">Nenhum lançamento compatível. Registre ou importe o lançamento no Extrato e tente novamente.</p>}
  </>
}

function OccurrenceDialog({ action, props, close, write }: {
  action: Extract<Action, { row: Occurrence }>; props: Props; close: () => void; write: (resource: string, record: object) => Promise<void>
}) {
  const { row, kind } = action
  const labels = { adjust: 'Editar ocorrência', skip: 'Pular ocorrência', restore: 'Restaurar ocorrência', link: 'Conciliar lançamento' }
  return <RecordDialog title={labels[kind]} dismiss={close} save={async (fields) => {
    const details = kind === 'adjust' ? { expectedOn: field(fields, 'expectedOn'), amountCents: amount(fields) }
      : kind === 'link' ? { entryId: field(fields, 'entryId') } : {}
    await write('recurrence-occurrences', { id: row.seriesId, scheduledOn: row.scheduledOn, action: kind, ...details })
  }}>
    <p className="financial-context">{row.name} · {formatDate(row.expectedOn)} · {formatBrlCents(row.plannedCents)}</p>
    {kind === 'adjust' && <div className="ledger-fields">
      <label>Nova data prevista<input name="expectedOn" type="date" defaultValue={row.expectedOn} required /></label>
      <label>Valor previsto em reais<input name="amount" inputMode="decimal" defaultValue={moneyInput(row.plannedCents)} required /></label>
    </div>}
    {kind === 'link' && <ActualPicker props={props} row={row} />}
  </RecordDialog>
}

function MonthlyTotals({ rows }: { rows: Occurrence[] }) {
  let planned = 0n
  let confirmed = 0n
  let plannedIncome = 0n
  let confirmedIncome = 0n
  for (const row of rows) {
    if (row.skipped) continue
    if (row.kind === 'income') {
      if (row.actualCents !== null) confirmedIncome += BigInt(row.actualCents)
      else plannedIncome += BigInt(row.plannedCents)
    } else if (row.actualCents !== null) confirmed += BigInt(row.actualCents)
    else planned += BigInt(row.plannedCents)
  }
  return <dl className="financial-values cash-values">
    <div><dt>Subtotal de cobranças do mês</dt><dd>{formatBrlCents(planned + confirmed)}</dd></div>
    <div><dt>Cobranças previstas</dt><dd>{formatBrlCents(planned)}</dd></div>
    <div><dt>Cobranças confirmadas</dt><dd>{formatBrlCents(confirmed)}</dd></div>
    {(plannedIncome > 0n || confirmedIncome > 0n) && <>
      <div><dt>Receitas previstas</dt><dd>{formatBrlCents(plannedIncome)}</dd></div>
      <div><dt>Receitas confirmadas</dt><dd>{formatBrlCents(confirmedIncome)}</dd></div>
    </>}
  </dl>
}

export function RecurrencesView(props: Props) {
  const [month, setMonth] = useState(() => dateInBrasilia().slice(0, 7))
  const [cardId, setCardId] = useState('')
  const [action, setAction] = useState<Action>()
  const { data, feedback } = useReport<RecurrenceReport>(`${props.url}/recurrences?month=${month}-01`, props.revision, props.expireSession)
  const rows = data?.occurrences.filter((row) => !cardId || row.cardId === cardId) ?? []
  const seriesInMonth = new Set(data?.occurrences.map((row) => row.seriesId))
  const seriesForCard = new Set(rows.map((row) => row.seriesId))
  const list = data?.series.filter((series) => !cardId || seriesForCard.has(series.id) ||
    (!seriesInMonth.has(series.id) && (series.next ? series.next.cardId : series.cardId) === cardId)) ?? []
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
    <section className="ledger-surface" aria-label="Filtros de assinaturas">
      <div className="financial-controls">
        <label>Mês de referência<input type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value) }} /></label>
        <button type="button" className="ledger-primary" onClick={() => setAction({ kind: 'create' })}>Nova recorrência</button>
      </div>
      <div className="recurrence-cards" role="group" aria-label="Visões por cartão">
        <button type="button" className={cardId ? 'ledger-quiet' : 'ledger-primary'} aria-pressed={!cardId} onClick={() => setCardId('')}>Visão geral</button>
        {props.catalog.cards.map((card) => <button type="button" key={card.id}
          className={cardId === card.id ? 'ledger-primary' : 'ledger-quiet'} aria-pressed={cardId === card.id}
          onClick={() => setCardId(card.id)}>{cardLabel(card, props.catalog)}</button>)}
      </div>
    </section>
    {feedback}
    {data && <>
      <section className="ledger-surface" aria-label="Agenda do mês">
        <div className="ledger-section-heading"><h2>Agenda do mês</h2></div>
        <MonthlyTotals rows={rows} />
        {rows.length === 0 && <p className="ledger-empty">Nenhuma ocorrência no mês selecionado.</p>}
        <ul className="financial-rows">
          {rows.map((row) => <li key={`${row.seriesId}:${row.scheduledOn}`}>
            <div><strong>{row.name}</strong>
              <small>{formatDate(row.on)} · {instrumentName(row, props.catalog)} · {row.entryId ? 'Confirmada' : row.skipped ? 'Pulada' : 'Prevista'}</small>
              {row.entryId && <small>{row.description} · previsão de {formatBrlCents(row.plannedCents)} para {formatDate(row.expectedOn)}</small>}
              {!row.entryId && row.expectedOn !== row.scheduledOn && <small>Data original {formatDate(row.scheduledOn)}</small>}
            </div>
            <strong>{formatBrlCents(row.actualCents ?? row.plannedCents)}</strong>
            {!row.entryId && <div className="recurrence-actions">
              {row.skipped ? <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'restore', row })}>Restaurar</button> : <>
                <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'adjust', row })}>Editar ocorrência</button>
                <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'skip', row })}>Pular</button>
                <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'link', row })}>Conciliar</button>
              </>}
            </div>}
          </li>)}
        </ul>
      </section>
      <section className="ledger-surface" aria-label="Séries cadastradas">
        <div className="ledger-section-heading"><h2>Séries cadastradas</h2></div>
        {list.length === 0 && <p className="ledger-empty">Nenhuma série nesta visão.</p>}
        <ul className="financial-rows">
          {list.map((series) => <li key={series.id}>
            <div><strong>{series.name}</strong>
              <small>{kindLabels[series.kind]} · {cadenceLabels[series.cadence]}</small>
              {series.next ? <small>Próxima prevista em {formatDate(series.next.on)} · {instrumentName(series.next, props.catalog)}</small>
                : <small>Sem próximas ocorrências · {instrumentName(series, props.catalog)}</small>}
            </div>
            <strong>{formatBrlCents(series.next?.plannedCents ?? series.amountCents)}</strong>
            {series.changeOn && <button type="button" className="ledger-quiet" onClick={() => setAction({ kind: 'series', series })}>Alterar próximas</button>}
          </li>)}
        </ul>
      </section>
    </>}
    {action && ('row' in action
      ? <OccurrenceDialog props={props} action={action} close={close} write={write} />
      : <SeriesDialog props={props} series={action.kind === 'series' ? action.series : undefined} close={close} write={write} />)}
  </>
}
