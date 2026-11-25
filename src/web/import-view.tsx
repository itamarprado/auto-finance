import { useState } from 'react'
import type { FormEvent } from 'react'
import { dateInBrasilia } from '../domain/date.ts'
import { formatBrlCents } from '../domain/money.ts'
import type { ImportChoice, ImportPreview, ImportSummary } from '../server/database/imports.ts'
import type { LedgerCatalog, Statement } from '../server/database/ledger.ts'
import type { ImportTarget } from '../server/ledger/import-csv.ts'
import { useReport } from './financial-view.tsx'
import { field } from './ledger-form.tsx'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'

interface ImportProps {
  url: string
  catalog: LedgerCatalog
  revision: number
  saved: () => void
  expireSession: () => void
}

interface PendingImport { target: ImportTarget; csv: string; preview: ImportPreview }
const clock = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const kindLabels = { expense: 'Despesa', income: 'Receita', purchase: 'Compra', payment: 'Pagamento de fatura' }
const counted = (value: number, name: string) => `${value} ${name}${value === 1 ? '' : 's'}`

function downloadTemplate(kind: ImportTarget['targetKind']) {
  const example = kind === 'card'
    ? '2026-01-10;Compra fictícia;49,90;compra;exemplo-1;Casa;exemplo'
    : '2026-01-10;Despesa fictícia;-49,90;despesa;exemplo-1;Casa;exemplo'
  const url = URL.createObjectURL(new Blob([`\uFEFFdata;descricao;valor;tipo;id_externo;categoria;tags\r\n${example}\r\n`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `modelo-${kind === 'card' ? 'cartao' : 'conta'}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ImportsView({ url, catalog, revision, saved, expireSession }: ImportProps) {
  const [kind, setKind] = useState<ImportTarget['targetKind']>(catalog.accounts.length ? 'account' : 'card')
  const [draft, setDraft] = useState<PendingImport | null>(null)
  const [choices, setChoices] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fileKey, setFileKey] = useState(0)
  const history = useReport<ImportSummary[]>(`${url}/imports`, revision, expireSession)
  const destinations = kind === 'account' ? catalog.accounts : catalog.cards
  const actionable = draft?.preview.rows.filter((row) => !('issue' in row) && !row.duplicate) ?? []
  const canConfirm = draft && !draft.preview.repeated && actionable.length > 0
    && actionable.every((row) => choices[row.line]) && actionable.some((row) => choices[row.line] !== 'skip')

  function report(cause: unknown) {
    if (cause instanceof LedgerError && cause.status === 401) expireSession()
    else setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a importação.')
  }

  async function requestPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const file = data.get('csv')
    const targetId = field(data, 'targetId')
    setDraft(null)
    setError('')
    setNotice('')
    if (!(file instanceof File) || !file.size || file.size > 512 * 1024) {
      setError('Selecione um arquivo CSV de até 512 KB.')
      return
    }
    const target = { targetKind: kind, targetId }
    setBusy(true)
    try {
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const preview = await ledgerRequest<ImportPreview>(`${url}/imports/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, csv }),
      })
      setDraft({ target, csv, preview })
      setChoices(Object.fromEntries(preview.rows.flatMap((row) => {
        if ('issue' in row || row.duplicate || row.candidates.length || row.kind === 'payment') return []
        return [[row.line, 'create']]
      })))
    } catch (cause) {
      if (cause instanceof TypeError && !/fetch/i.test(cause.message)) setError('Salve o CSV com codificação UTF-8.')
      else report(cause)
    } finally { setBusy(false) }
  }

  async function confirm() {
    if (!draft || !canConfirm || busy) return
    setBusy(true)
    setError('')
    try {
      const decisions = actionable.map<ImportChoice>((row) => {
        const selected = choices[row.line]
        if (selected === 'create') return { line: row.line, action: 'create', acknowledged: 'candidates' in row && row.candidates.length > 0 }
        if (selected === 'skip') return { line: row.line, action: 'skip' }
        return { line: row.line, action: 'link', reference: selected }
      })
      const { batch, repeated } = await ledgerRequest<{ batch: ImportSummary; repeated: boolean }>(`${url}/imports/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft.target, csv: draft.csv, digest: draft.preview.digest, choices: decisions }),
      })
      setNotice(repeated ? 'Este arquivo já foi importado neste destino.' : `Lote confirmado. ${counted(batch.created, 'novo')} e ${counted(batch.linked, 'vinculado')}.`)
      setDraft(null)
      setFileKey((value) => value + 1)
      saved()
    } catch (cause) { report(cause) }
    finally { setBusy(false) }
  }

  return <>
    <form className="ledger-surface financial-controls" onSubmit={(event) => { void requestPreview(event) }}>
      <label>Tipo de destino<select value={kind} disabled={busy} onChange={(event) => {
        setKind(event.target.value as ImportTarget['targetKind'])
        setDraft(null)
      }}><option value="account">Conta</option><option value="card">Cartão</option></select></label>
      <label>Destino<select name="targetId" key={kind} defaultValue="" required disabled={busy} onChange={() => setDraft(null)}>
        <option value="" disabled>Selecione</option>
        {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Arquivo CSV<input type="file" accept=".csv,text/csv" name="csv" key={fileKey} required disabled={busy} onChange={() => setDraft(null)} /></label>
      <button type="button" className="ledger-quiet" onClick={() => downloadTemplate(kind)}>Baixar modelo CSV</button>
      <button type="submit" className="ledger-primary" disabled={busy || !destinations.length}>Gerar prévia</button>
    </form>
    {error && <p className="notice" role="alert">{error}</p>}
    {notice && <p className="finance-notice" role="status">{notice}</p>}
    {draft && <section className="ledger-surface financial-detail" aria-label="Prévia da importação">
      <div className="ledger-section-heading">
        <h2>Prévia da importação</h2>
        <button type="button" className="ledger-primary" disabled={!canConfirm || busy} onClick={() => { void confirm() }}>Confirmar importação</button>
      </div>
      {draft.preview.repeated ? <p className="ledger-empty">Este arquivo já foi importado neste destino.</p>
        : <ul className="financial-rows">
          {draft.preview.rows.map((row) => <li key={row.line}>
            {'issue' in row ? <div><strong>Registro {row.line} rejeitado</strong><small>{row.issue}</small></div> : <>
              <div><strong>{row.description}</strong><small>Registro {row.line} · {formatDate(row.occurredOn)} · {kindLabels[row.kind]} · {formatBrlCents(String(row.amountCents))}</small>
                {row.kind === 'payment' && !row.candidates.length && <small>Registre o pagamento na fatura antes de vinculá-lo.</small>}
              </div>
              {row.duplicate ? <span>Identificador já importado</span> : <label>Decisão do registro {row.line}
                <select className="ledger-quiet" value={choices[row.line] ?? ''} disabled={busy}
                  onChange={(event) => setChoices({ ...choices, [row.line]: event.target.value })}>
                  <option value="" disabled>Revisar</option>
                  {row.kind !== 'payment' && <option value="create">Importar como novo</option>}
                  {row.candidates.map((item) => <option key={`${item.source}:${item.id}`} value={`${item.source}:${item.id}`}>Vincular a {item.description} · {item.id.slice(0, 8)}</option>)}
                  <option value="skip">Ignorar</option>
                </select>
              </label>}
            </>}
          </li>)}
        </ul>}
    </section>}
    <section className="ledger-surface import-history" aria-label="Histórico de lotes">
      <div className="ledger-section-heading"><h2>Histórico de lotes</h2></div>
      {history.feedback}
      {history.data?.length ? <ul className="financial-rows">{history.data.map((batch) => <li key={batch.id}>
        <div><strong>{batch.targetName}</strong><small>{clock.format(new Date(batch.createdAt))}</small></div>
        <span>{[counted(batch.created, 'novo'), counted(batch.linked, 'vinculado'), counted(batch.duplicates, 'duplicado'),
          counted(batch.skipped, 'ignorado'), counted(batch.rejected, 'rejeitado')].join(' · ')}</span>
      </li>)}</ul> : history.data && <p className="ledger-empty">Nenhum lote registrado.</p>}
    </section>
  </>
}

interface MonthlyReport {
  from: string
  to: string
  statement: Statement
  cash: { netCents: string; paidCents: string; reimbursementNetCents: string }
}

export function MonthlyView({ url, revision, expireSession }: Omit<ImportProps, 'catalog' | 'saved'>) {
  const [month, setMonth] = useState(() => dateInBrasilia().slice(0, 7))
  const { data, feedback } = useReport<MonthlyReport>(`${url}/monthly?month=${month}-01`, revision, expireSession)
  const summary = data?.statement
  const total = (value: string) => formatBrlCents(value)
  return <>
    <div className="ledger-surface financial-controls">
      <label>Mês de referência<input type="month" value={month} onChange={(event) => {
        if (event.target.value) setMonth(event.target.value)
      }} /></label>
      {data && <a className="ledger-quiet finance-download" href={`${url}/entries.csv?from=${data.from}&to=${data.to}`} download>Exportar extrato do mês</a>}
    </div>
    {feedback}
    {data && summary && <section className="ledger-surface" aria-label="Fechamento mensal">
      <div className="ledger-section-heading"><h2>Resumo do período</h2><span>{formatDate(data.from)} a {formatDate(data.to)} · {summary.count} no extrato</span></div>
      <dl className="financial-values cash-values">
        <div><dt>Receitas</dt><dd>{total(summary.incomeCents)}</dd></div>
        <div><dt>Despesas em conta</dt><dd>{total(summary.expenseCents)}</dd></div>
        <div><dt>Compras no cartão</dt><dd>{total(summary.purchaseCents)}</dd></div>
        <div><dt>Estornos de compra</dt><dd>{total(summary.refundCents)}</dd></div>
        <div><dt>Pagamentos de fatura líquidos</dt><dd>{total(data.cash.paidCents)}</dd></div>
        <div><dt>Reembolsos líquidos</dt><dd>{total(data.cash.reimbursementNetCents)}</dd></div>
        <div><dt>Variação de caixa efetivada</dt><dd>{total(data.cash.netCents)}</dd></div>
      </dl>
      <div className="ledger-section-heading"><h2>Totais por categoria</h2></div>
      <ul className="financial-rows">
        {summary.categories.map((category) => <li key={category.category ?? ''}>
          <div><strong>{category.category ?? 'Sem categoria'}</strong>
            <small>Receitas {total(category.incomeCents)} · Despesas {total(category.expenseCents)}</small>
            <small>Compras {total(category.purchaseCents)} · Estornos {total(category.refundCents)}</small></div>
        </li>)}
      </ul>
      {!summary.categories.length && <p className="ledger-empty">Nenhum lançamento no mês.</p>}
    </section>}
  </>
}
