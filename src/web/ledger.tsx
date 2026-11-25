import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { currentMonthBounds } from '../domain/date.ts'
import { formatBrlCents } from '../domain/money.ts'
import type { LedgerCatalog, Statement } from '../server/database/ledger.ts'
import { LedgerForm, RecordDialog, entryLabels, field, formLabels, sectionLabels } from './ledger-form.tsx'
import type { LedgerSection } from './ledger-form.tsx'
import { CashView, InvoicesView } from './financial-view.tsx'
import { defaultInvoiceRoute, readInvoiceRoute, writeInvoiceRoute } from './invoice-navigation.ts'
import type { InvoiceRoute } from './invoice-navigation.ts'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'
import { ImportsView, MonthlyView } from './import-view.tsx'
import { SplitsView } from './splits-view.tsx'

interface Filters {
  from: string
  to: string
  origin: string
  kind: string
  search: string
  category: string
  tag: string
  page: number
}

type Screen = LedgerSection | 'invoices' | 'cash' | 'imports' | 'monthly' | 'splits'
const screenLabels = { ...sectionLabels, invoices: 'Faturas', cash: 'Fluxo de caixa', imports: 'Importar CSV', monthly: 'Fechamento mensal', splits: 'Rateios e acertos' }
const symbols = { entries: '≡', holders: '◉', accounts: '▤', cards: '▰', invoices: '▤', cash: '↔', imports: '↓', monthly: '▦', splits: '÷' }
const sections: Screen[] = ['entries', 'invoices', 'cash', 'splits', 'imports', 'monthly', 'holders', 'accounts', 'cards']
const incomingKinds = new Set(['income', 'refund', 'reimbursement_in'])

function isManualScreen(section: Screen): section is LedgerSection {
  return Object.hasOwn(formLabels, section)
}

function initialFilters(): Filters {
  return {
    ...currentMonthBounds(),
    origin: '', kind: '', search: '', category: '', tag: '', page: 1,
  }
}

function statementQuery(filters: Filters): string {
  const query = new URLSearchParams({ page: String(filters.page) })
  for (const key of ['from', 'to', 'kind', 'search', 'category', 'tag'] as const) {
    if (filters[key]) query.set(key, filters[key])
  }
  if (filters.origin) {
    const [kind, id] = filters.origin.split(':')
    query.set(kind === 'account' ? 'accountId' : 'cardId', id)
  }
  return query.toString()
}

function StatementView({ catalog, statement, filters, apply, loading, url, saveLabels }: {
  catalog: LedgerCatalog
  statement: Statement
  filters: Filters
  apply: (filters: Filters) => void
  loading: boolean
  url: string
  saveLabels: (record: { id: string; category: string; tags: string[] }) => Promise<void>
}) {
  const [editing, setEditing] = useState<Statement['entries'][number] | null>(null)
  const balance = catalog.accounts
    .filter((account) => account.includeInBalance)
    .reduce((total, account) => total + BigInt(account.balanceCents), 0n)
  const stats = [
    { label: 'Saldo atual em contas', value: balance, accent: 'balance' },
    { label: 'Receitas no filtro', value: statement.incomeCents, accent: 'income' },
    { label: 'Despesas no filtro', value: statement.expenseCents, accent: 'expense' },
    { label: 'Compras no cartão no filtro', value: statement.purchaseCents, accent: 'purchase' },
  ]
  if (statement.refundCents !== '0') stats.push({ label: 'Estornos no filtro', value: statement.refundCents, accent: 'income' })
  const pages = Math.max(1, Math.ceil(statement.count / statement.pageSize))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    apply({
      from: String(data.get('from') ?? ''),
      to: String(data.get('to') ?? ''),
      origin: String(data.get('origin') ?? ''),
      kind: String(data.get('kind') ?? ''),
      search: String(data.get('search') ?? '').trim(),
      category: field(data, 'category'),
      tag: field(data, 'tag'),
      page: 1,
    })
  }

  return (
    <>
      <section className="ledger-stats" aria-label="Resumo financeiro">
        {stats.map(({ label, value, accent }) => (
          <div className={`ledger-stat ledger-stat-${accent}`} key={label}>
            <span>{label}</span>
            <strong>{formatBrlCents(value)}</strong>
          </div>
        ))}
      </section>
      <section className="ledger-surface" aria-label="Extrato por período" aria-busy={loading}>
        <div className="ledger-section-heading">
          <h2>Movimentações</h2>
          <span>{statement.count} {statement.count === 1 ? 'lançamento' : 'lançamentos'}</span>
          {statement.count > 0 && statement.count <= 5000 && !loading && <a className="ledger-quiet finance-download"
            href={`${url}/entries.csv?${statementQuery(filters)}`} download>Exportar CSV</a>}
        </div>
        <form className="ledger-filters" onSubmit={submit}>
          <label>Descrição<input name="search" type="search" maxLength={160} defaultValue={filters.search} placeholder="Buscar lançamento" /></label>
          <label>Origem<select name="origin" defaultValue={filters.origin}>
            <option value="">Todas as origens</option>
            {catalog.accounts.length > 0 && <optgroup label="Contas">
              {catalog.accounts.map((item) => <option key={item.id} value={`account:${item.id}`}>{item.name}</option>)}
            </optgroup>}
            {catalog.cards.length > 0 && <optgroup label="Cartões">
              {catalog.cards.map((item) => <option key={item.id} value={`card:${item.id}`}>{item.name}</option>)}
            </optgroup>}
          </select></label>
          <label>Tipo<select name="kind" defaultValue={filters.kind}>
            <option value="">Todos os tipos</option>
            <option value="income">Receita</option><option value="expense">Despesa</option><option value="purchase">Compra no cartão</option>
            <option value="refund">Estorno no cartão</option>
            <option value="reimbursement_in">Reembolso recebido</option>
            <option value="reimbursement_out">Reembolso enviado</option>
          </select></label>
          <label>De<input name="from" type="date" defaultValue={filters.from} /></label>
          <label>Até<input name="to" type="date" defaultValue={filters.to} /></label>
          <button className="ledger-quiet" type="submit" disabled={loading}>Filtrar</button>
          <label>Categoria<input name="category" maxLength={80} defaultValue={filters.category} /></label>
          <label>Tag<input name="tag" maxLength={40} defaultValue={filters.tag} /></label>
        </form>
        {statement.entries.length ? (
          <div className="ledger-table-wrap" tabIndex={0} aria-label="Lista de movimentações">
            <table className="ledger-table" role="table">
              <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Data</th><th scope="col" role="columnheader">Descrição</th><th scope="col" role="columnheader">Origem</th><th scope="col" role="columnheader">Tipo</th><th scope="col" role="columnheader">Valor</th></tr></thead>
              <tbody role="rowgroup">{statement.entries.map((entry) => (
                <tr key={`${entry.source}:${entry.id}`} role="row">
                  <td role="cell"><time dateTime={entry.occurredOn}>{formatDate(entry.occurredOn)}</time></td>
                  <td role="cell">
                    <strong>{entry.description}</strong>
                    {(entry.category || entry.tags.length > 0) && <small>{[entry.category, ...entry.tags].filter(Boolean).join(' · ')}</small>}
                    {entry.source === 'entry' && <button type="button" className="ledger-text-action" aria-label={`Classificar ${entry.description}`}
                      onClick={() => setEditing(entry)}>Classificar</button>}
                  </td>
                  <td role="cell">{entry.instrumentName}<small>{entry.holderName}</small></td>
                  <td role="cell"><span className={`ledger-tag ledger-tag-${entry.kind}`}>{entryLabels[entry.kind]}</span></td>
                  <td role="cell" className={`ledger-amount ${incomingKinds.has(entry.kind) ? 'ledger-positive' : ''}`}>
                    {formatBrlCents(BigInt(entry.amountCents) * (incomingKinds.has(entry.kind) ? 1n : -1n))}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="ledger-empty">Nenhuma movimentação para o filtro atual.</p>}
        {pages > 1 && <div className="ledger-pages">
          <button type="button" className="ledger-quiet" disabled={loading || statement.page <= 1} onClick={() => apply({ ...filters, page: statement.page - 1 })}>Anterior</button>
          <span>Página {statement.page} de {pages}</span>
          <button type="button" className="ledger-quiet" disabled={loading || statement.page >= pages} onClick={() => apply({ ...filters, page: statement.page + 1 })}>Próxima</button>
        </div>}
      </section>
      {editing && <RecordDialog title="Classificar lançamento" dismiss={() => setEditing(null)} save={async (data) => {
        await saveLabels({ id: editing.id, category: field(data, 'category'),
          tags: field(data, 'tags').split('|').map((value) => value.trim()).filter(Boolean) })
        setEditing(null)
      }}>
        <p className="financial-context">{editing.description}</p>
        <label>Categoria<input name="category" maxLength={80} defaultValue={editing.category ?? ''} /></label>
        <label>Tags separadas por |<input name="tags" maxLength={500} defaultValue={editing.tags.join(' | ')} /></label>
      </RecordDialog>}
    </>
  )
}

function CatalogView({ section, catalog }: {
  section: Exclude<LedgerSection, 'entries'>
  catalog: LedgerCatalog
}) {
  const holderNames = new Map(catalog.holders.map((holder) => [holder.id, holder.name]))
  const accountNames = new Map(catalog.accounts.map((account) => [account.id, account.name]))
  if (!catalog[section].length) return <div className="ledger-surface ledger-empty">Use “{formLabels[section]}” para iniciar os cadastros.</div>

  return (
    <ul className="ledger-catalog">
      {section === 'holders' && catalog.holders.map((holder) => <li key={holder.id}><strong>{holder.name}</strong></li>)}
      {section === 'accounts' && catalog.accounts.map((account) => <li key={account.id}>
        <strong>{account.name}</strong>
        <span>{holderNames.get(account.holderId)} · {account.kind === 'bank' ? 'Conta bancária' : 'Carteira'}</span>
        <p>{formatBrlCents(account.balanceCents)}</p>
        <small>{account.includeInBalance ? 'Incluída no saldo consolidado' : 'Fora do saldo consolidado'}</small>
      </li>)}
      {section === 'cards' && catalog.cards.map((card) => <li key={card.id}>
        <strong>{card.name}{card.lastFour ? ` · •••• ${card.lastFour}` : ''}</strong>
        <span>{holderNames.get(card.holderId)}{card.paymentAccountId ? ` · Pagamento por ${accountNames.get(card.paymentAccountId)}` : ''}</span>
        <p>{formatBrlCents(card.limitCents)} <small>de limite</small></p>
        <small>Fecha no dia {card.closingDay} · Vence no dia {card.dueDay}</small>
      </li>)}
    </ul>
  )
}

export function Ledger({ workspace, databaseStatus, chooseWorkspace, logout, expireSession, sessionError, busy }: {
  workspace: { id: string; name: string }
  databaseStatus: ReactNode
  chooseWorkspace: () => void
  logout: () => void
  expireSession: () => void
  sessionError: string
  busy: boolean
}) {
  const [baseSection, setBaseSection] = useState<Exclude<Screen, 'invoices'>>('entries')
  const [route, setRoute] = useState(readInvoiceRoute)
  const invoiceRoute = route?.workspaceId === workspace.id ? route : null
  const section: Screen = invoiceRoute ? 'invoices' : baseSection
  const [form, setForm] = useState<LedgerSection | null>(null)
  const [filters, setFilters] = useState(initialFilters)
  const [data, setData] = useState<{ catalog: LedgerCatalog; statement: Statement } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const url = `/api/workspaces/${encodeURIComponent(workspace.id)}/ledger`
  const query = statementQuery(filters)

  useEffect(() => {
    function restore() {
      setRoute(readInvoiceRoute())
      setNotice('')
      setForm(null)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  function navigateInvoice(next: InvoiceRoute | null, mode: 'push' | 'replace' = 'push', fromList = false) {
    writeInvoiceRoute(next, mode, fromList)
    setRoute(next)
    setNotice('')
  }

  function setSection(next: Screen) {
    setNotice('')
    if (next === 'invoices') {
      if (!invoiceRoute) navigateInvoice(defaultInvoiceRoute(workspace.id))
      else if (invoiceRoute.detail) navigateInvoice({ ...invoiceRoute, detail: undefined })
    } else {
      if (invoiceRoute) navigateInvoice(null)
      setBaseSection(next)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    setLoading(true)
    setError('')
    Promise.all([
      ledgerRequest<LedgerCatalog>(`${url}/catalog`, { signal }),
      ledgerRequest<Statement>(`${url}/entries?${query}`, { signal }),
    ]).then(([catalog, statement]) => {
      if (!signal.aborted) setData({ catalog, statement })
    }).catch((cause: unknown) => {
      if (signal.aborted) return
      if (cause instanceof LedgerError && cause.status === 401) expireSession()
      else {
        if (cause instanceof LedgerError && (cause.status === 403 || cause.status === 404)) {
          setData(null)
          setForm(null)
        }
        setError(cause instanceof LedgerError ? cause.message : 'Não foi possível carregar o espaço financeiro.')
      }
    }).finally(() => { if (!signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [url, query, revision, expireSession])

  function openForm() {
    if (!data || !isManualScreen(section)) return
    const { catalog } = data
    setNotice('')
    if ((section === 'accounts' || section === 'cards') && !catalog.holders.length) {
      setSection('holders')
      setNotice('Cadastre um titular para vincular a conta ou o cartão.')
      return
    }
    if (section === 'entries' && !catalog.accounts.length && !catalog.cards.length) {
      setSection(catalog.holders.length ? 'accounts' : 'holders')
      setNotice('Cadastre o titular e uma conta ou cartão antes do primeiro lançamento.')
      return
    }
    setForm(section)
  }

  function saved() {
    setNotice('Registro salvo.')
    setRevision((previous) => previous + 1)
  }

  async function save(record: object, resource: LedgerSection | 'classifications' | null = form) {
    try {
      await ledgerRequest(`${url}/${resource}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
      setForm(null)
      saved()
    } catch (cause) {
      if (cause instanceof LedgerError && cause.status === 401) expireSession()
      if (cause instanceof LedgerError && cause.status === 409) setRevision((previous) => previous + 1)
      throw cause
    }
  }

  return (
    <div className="finance-shell">
      <aside className="finance-sidebar">
        <div className="finance-brand"><span aria-hidden="true">AF</span> Auto Finance</div>
        <nav aria-label="Área financeira">
          {sections.map((item) => (
            <button key={item} type="button" aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}>
              <span className="finance-symbol" aria-hidden="true">{symbols[item]}</span>{screenLabels[item]}
            </button>
          ))}
        </nav>
        <div className="finance-sidebar-footer">
          {databaseStatus}
          <button type="button" onClick={chooseWorkspace} disabled={busy}>Trocar de espaço</button>
          <button type="button" onClick={logout} disabled={busy}>Sair</button>
        </div>
      </aside>
      <main className="finance-main">
        <header className="finance-header">
          <div><p>Espaço ativo: <strong>{workspace.name}</strong></p><h1>{invoiceRoute?.detail ? 'Detalhe da fatura' : screenLabels[section]}</h1></div>
          {isManualScreen(section) &&
            <button type="button" className="ledger-primary" onClick={openForm} disabled={!data || loading}>{formLabels[section]}</button>}
        </header>
        {notice && <p className="finance-notice" aria-live="polite">{notice}</p>}
        {sessionError && <p className="notice" role="alert">{sessionError}</p>}
        {error && <div className="notice" role="alert">{error} <button className="ledger-quiet" type="button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button></div>}
        {data && section === 'entries' && <StatementView catalog={data.catalog} statement={data.statement} filters={filters}
          apply={setFilters} loading={loading} url={url} saveLabels={(record) => save(record, 'classifications')} />}
        {data && invoiceRoute && <InvoicesView url={url} catalog={data.catalog} revision={revision} saved={saved} expireSession={expireSession}
          route={invoiceRoute} navigate={navigateInvoice} />}
        {data && section === 'cash' && <CashView url={url} catalog={data.catalog} revision={revision} saved={saved} expireSession={expireSession} />}
        {data && section === 'imports' && <ImportsView url={url} catalog={data.catalog} revision={revision} saved={saved} expireSession={expireSession} />}
        {data && section === 'monthly' && <MonthlyView url={url} revision={revision} expireSession={expireSession} />}
        {data && section === 'splits' && <SplitsView url={url} catalog={data.catalog} revision={revision} saved={saved} expireSession={expireSession} />}
        {data && isManualScreen(section) && section !== 'entries' && <CatalogView section={section} catalog={data.catalog} />}
        {!data && loading && <p className="ledger-surface ledger-empty">Carregando o espaço financeiro…</p>}
        {data && form && <LedgerForm section={form} catalog={data.catalog} dismiss={() => setForm(null)} save={save} />}
      </main>
    </div>
  )
}
