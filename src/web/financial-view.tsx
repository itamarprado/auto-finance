import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { dateInBrasilia, currentMonthBounds } from '../domain/date.ts'
import { formatBrlCents, parseBrlCents } from '../domain/money.ts'
import type { CashStatement } from '../server/database/cash.ts'
import type { InvoiceCharge, InvoiceKey, InvoiceSummary, Invoices } from '../server/database/invoices.ts'
import type { LedgerCatalog } from '../server/database/ledger.ts'
import { field, RecordDialog } from './ledger-form.tsx'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'
import { defaultInvoiceRoute, relativeMonth } from './invoice-navigation.ts'
import type { InvoiceRoute } from './invoice-navigation.ts'

interface ViewProps {
  url: string
  catalog: LedgerCatalog
  revision: number
  saved: () => void
  expireSession: () => void
}

type Action =
  | { kind: 'installments'; cardId: string }
  | { kind: 'payments'; invoice: InvoiceKey; openCents: string }
  | { kind: 'refunds'; invoice: InvoiceKey; charge: InvoiceCharge }
  | { kind: 'payment-reversals'; paymentId: string; amountCents: string }
  | { kind: 'transfers'; accountId: string }

const actionTitles = {
  installments: 'Nova compra parcelada', payments: 'Registrar pagamento',
  refunds: 'Estornar compra', 'payment-reversals': 'Estornar pagamento', transfers: 'Nova transferência',
}

const movementLabels = {
  income: 'Receita', expense: 'Despesa', payment: 'Pagamento de fatura',
  payment_reversal: 'Estorno de pagamento', transfer: 'Transferência', refund: 'Estorno de compra',
}

function useReport<T>(url: string, revision: number, expireSession: () => void) {
  const [result, setResult] = useState<{ url: string; revision: number; data?: T; error?: string }>()
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    ledgerRequest<T>(url, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult({ url, revision, data }) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (cause instanceof LedgerError && cause.status === 401) expireSession()
        else setResult({ url, revision, error: cause instanceof Error ? cause.message : 'Consulta indisponível.' })
      })
    return () => controller.abort()
  }, [url, revision, retry, expireSession])
  const current = result?.url === url && result.revision === revision ? result : undefined
  const error = current?.error
  return {
    data: current?.data,
    feedback: error ? <div className="notice" role="alert">{error} <button type="button" className="ledger-quiet"
      onClick={() => { setResult(undefined); setRetry((value) => value + 1) }}>Tentar novamente</button></div>
      : !current && <p role="status" className="ledger-empty">Carregando…</p>,
  }
}

function DetailsAmount({ label, amount }: { label: string; amount: string }) {
  return <div><dt>{label}</dt><dd>{formatBrlCents(amount)}</dd></div>
}

function accountOptions(catalog: LedgerCatalog) {
  return catalog.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)
}

function FinancialDialog({ action, props, dismiss }: { action: Action; props: ViewProps; dismiss: () => void }) {
  const { catalog, url } = props
  const today = dateInBrasilia()
  const { kind } = action
  const card = kind === 'payments' ? catalog.cards.find((item) => item.id === action.invoice.cardId) : undefined

  async function save(data: FormData, id: string) {
    const occurredOn = field(data, 'occurredOn')
    let record: object
    if (action.kind === 'payment-reversals') record = { id, occurredOn, paymentId: action.paymentId }
    else {
      const amountCents = parseBrlCents(field(data, 'amount'))
      if (amountCents <= 0) throw new Error('Informe um valor maior que zero.')
      const base = { id, occurredOn, amountCents }
      if (action.kind === 'installments') {
        const firstCycle = field(data, 'firstCycle')
        record = { ...base, cardId: field(data, 'cardId'), description: field(data, 'description'),
          installmentCount: Number(field(data, 'installmentCount')), firstCycle: firstCycle ? `${firstCycle}-01` : undefined }
      } else if (action.kind === 'transfers') {
        record = { ...base, description: field(data, 'description'), accountId: field(data, 'accountId'), destinationId: field(data, 'destinationId') }
      } else if (action.kind === 'payments') {
        record = { ...base, ...action.invoice, accountId: field(data, 'accountId') }
      } else {
        record = { ...base, ...action.invoice, chargeId: action.charge.id, source: action.charge.source }
      }
    }
    try {
      await ledgerRequest(`${url}/${action.kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
      dismiss()
      props.saved()
    } catch (cause) {
      if (cause instanceof LedgerError && cause.status === 401) props.expireSession()
      throw cause
    }
  }

  return <RecordDialog title={actionTitles[kind]} dismiss={dismiss} save={save}>
    {(kind === 'installments' || kind === 'transfers') && <label>Descrição<input name="description" maxLength={160} required /></label>}
    {kind === 'installments' && <>
      <label>Cartão<select name="cardId" required defaultValue={action.cardId}>
        <option value="" disabled>Selecione</option>
        {catalog.cards.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select></label>
      <div className="ledger-fields">
        <label>Número de parcelas<input name="installmentCount" type="number" min={2} max={60} defaultValue="2" required /></label>
        <label>Primeiro ciclo (opcional)<input name="firstCycle" type="month" /></label>
      </div>
    </>}
    {kind === 'transfers' && <div className="ledger-fields">
      <label>Conta de origem<select name="accountId" required defaultValue={action.accountId}>
        <option value="" disabled>Selecione</option>{accountOptions(catalog)}
      </select></label>
      <label>Conta de destino<select name="destinationId" required defaultValue="">
        <option value="" disabled>Selecione</option>{accountOptions(catalog)}
      </select></label>
    </div>}
    {kind === 'payments' && <>
      <p className="financial-context">Em aberto {formatBrlCents(action.openCents)}</p>
      <label>Conta pagadora<select name="accountId" required defaultValue={card?.paymentAccountId ?? ''}>
        <option value="" disabled>Selecione</option>{accountOptions(catalog)}
      </select></label>
    </>}
    {kind === 'refunds' && <p className="financial-context">{action.charge.description} · Disponível {formatBrlCents(action.charge.availableRefundCents)}</p>}
    {kind === 'payment-reversals' && <p className="financial-context">Reverte {formatBrlCents(action.amountCents)} para a conta usada no pagamento.</p>}
    <div className="ledger-fields">
      {kind !== 'payment-reversals' && <label>Valor em reais<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>}
      <label>Data da movimentação<input name="occurredOn" type="date" defaultValue={today}
        max={kind === 'installments' ? undefined : today}
        min={kind === 'refunds' ? action.charge.purchasedOn : undefined} required /></label>
    </div>
  </RecordDialog>
}

interface InvoiceViewProps extends ViewProps {
  route: InvoiceRoute
  navigate: (route: InvoiceRoute, mode?: 'push' | 'replace', fromList?: boolean) => void
}

const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const periodLabel = (cycleMonth: string) => monthLabel.format(new Date(`${cycleMonth}T00:00:00Z`))

function invoiceStatus(row: InvoiceSummary) {
  if (row.creditCents !== '0') return 'Crédito no ciclo'
  if (row.openCents === '0') return row.paidCents !== '0' ? 'Quitada' : 'Sem saldo em aberto'
  return row.closed ? 'Ciclo fechado' : 'Ciclo aberto'
}

function InvoiceList(props: InvoiceViewProps) {
  const { route, catalog, navigate } = props
  const [action, setAction] = useState<Action | null>(null)
  const query = new URLSearchParams({ from: `${route.from}-01`, to: `${route.to}-01` })
  const { data, feedback } = useReport<InvoiceSummary[]>(`${props.url}/invoice-cycles?${query}`, props.revision, props.expireSession)
  const group = route.group ?? data?.[0]?.cardId ?? catalog.cards[0]?.id
  const restored = useRef(false)
  useEffect(() => {
    if (!data || restored.current) return
    restored.current = true
    const scroll = window.history.state?.invoiceScroll
    if (typeof scroll === 'number') window.scrollTo(0, scroll)
  }, [data])

  const cycles = new Map<string, InvoiceSummary[]>()
  for (const cycle of data ?? []) {
    const group = cycles.get(cycle.cardId)
    if (group) group.push(cycle)
    else cycles.set(cycle.cardId, [cycle])
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    navigate({ ...route, from: field(form, 'from'), to: field(form, 'to') }, 'replace')
  }

  function open(cycle: InvoiceSummary) {
    window.history.replaceState({ ...window.history.state, invoiceScroll: window.scrollY }, '')
    navigate({ ...route, group: cycle.cardId, detail: { cardId: cycle.cardId, month: cycle.cycleMonth.slice(0, 7) } }, 'push', true)
    window.scrollTo(0, 0)
  }

  return <>
    <form key={`${route.from}:${route.to}`} className="ledger-surface financial-controls invoice-period" onSubmit={apply}>
      <label>Do mês<input name="from" type="month" required defaultValue={route.from} /></label>
      <label>Até o mês<input name="to" type="month" required defaultValue={route.to} /></label>
      <button type="submit" className="ledger-quiet">Filtrar faturas</button>
      <button type="button" className="ledger-quiet" onClick={() => navigate({ ...defaultInvoiceRoute(route.workspaceId), group: route.group }, 'replace')}>Últimos 12 meses</button>
      <button type="button" className="ledger-quiet" onClick={() => navigate({ ...route, from: relativeMonth(1), to: relativeMonth(12) }, 'replace')}>Próximos 12 meses</button>
      <button type="button" className="ledger-primary" disabled={!catalog.cards.length}
        onClick={() => setAction({ kind: 'installments', cardId: group ?? '' })}>{actionTitles.installments}</button>
    </form>
    {feedback}
    {data && (catalog.cards.length ? <div className="invoice-groups" aria-label="Faturas por cartão">
      {catalog.cards.map((card) => {
        const rows = cycles.get(card.id) ?? []
        const expanded = group === card.id
        const panelId = `cycles-${card.id}`
        return <section className="ledger-surface invoice-group" key={card.id} aria-label={card.name}>
          <h2><button type="button" className="invoice-group-toggle" aria-expanded={expanded} aria-controls={panelId}
            onClick={() => navigate({ ...route, group: expanded ? '' : card.id }, 'replace')}>
            <span>{card.name}{card.lastFour && ` · •••• ${card.lastFour}`}
              <small>{catalog.holders.find((holder) => holder.id === card.holderId)?.name}</small></span>
            <span className="invoice-count">{rows.length} {rows.length === 1 ? 'fatura' : 'faturas'}</span>
          </button></h2>
          <div id={panelId} hidden={!expanded}>
            {rows.length ? <ul className="invoice-cycle-list">
              {rows.map((cycle) => <li key={cycle.cycleMonth}>
                <button type="button" className="invoice-cycle-button" onClick={() => open(cycle)}>
                  <span><strong>{periodLabel(cycle.cycleMonth)}</strong><small>Vence em {formatDate(cycle.dueOn)}</small></span>
                  <span>{invoiceStatus(cycle)}</span>
                  <span><strong>{formatBrlCents(cycle.creditCents !== '0' ? cycle.creditCents : cycle.openCents !== '0' ? cycle.openCents : cycle.paidCents)}</strong>
                    <small>{cycle.creditCents !== '0' ? 'A favor' : cycle.openCents !== '0' ? 'Em aberto' : 'Pago'}</small></span>
                </button>
              </li>)}
            </ul> : <p className="ledger-empty">Nenhuma fatura no período.</p>}
          </div>
        </section>
      })}
    </div> : <p className="ledger-surface ledger-empty">Cadastre um cartão para acompanhar suas faturas.</p>)}
    {action && <FinancialDialog action={action} props={props} dismiss={() => setAction(null)} />}
  </>
}

function InvoicePage(props: InvoiceViewProps & { detail: NonNullable<InvoiceRoute['detail']> }) {
  const [action, setAction] = useState<Action | null>(null)
  const { cardId, month } = props.detail
  const invoice = { cycleMonth: `${month}-01`, cardId }
  const query = new URLSearchParams({ ...invoice })
  const { data, feedback } = useReport<Invoices>(`${props.url}/invoices?${query}`, props.revision, props.expireSession)
  const active = data?.summaries.find((row) => row.cardId === cardId)
  function back() {
    if (window.history.state?.invoiceFromList) window.history.back()
    else props.navigate({ ...props.route, group: cardId, detail: undefined }, 'replace')
  }
  return <>
    <button type="button" className="ledger-quiet invoice-back" onClick={back}>Voltar para faturas</button>
    {feedback}
    {active && data?.detail && <section className="ledger-surface financial-detail" aria-label="Detalhes da fatura">
      <div className="ledger-section-heading">
        <div className="invoice-identity">
          <h2>{active.cardName} · {periodLabel(active.cycleMonth)}</h2>
          <p>{active.holderName} · {invoiceStatus(active)}</p>
          <p>Fecha em {formatDate(active.closingOn)} · Vence em {formatDate(active.dueOn)}</p>
        </div>
        <button className="ledger-primary" type="button" disabled={active.openCents === '0' || !props.catalog.accounts.length}
          onClick={() => setAction({ kind: 'payments', invoice, openCents: active.openCents })}>{actionTitles.payments}</button>
      </div>
      <dl className="financial-values cash-values" aria-label="Resumo da fatura">
        <DetailsAmount label="Compras e parcelas" amount={active.chargeCents} />
        <DetailsAmount label="Estornos" amount={active.refundCents} />
        <DetailsAmount label="Pago" amount={active.paidCents} />
        <DetailsAmount label="Em aberto" amount={active.openCents} />
        {active.creditCents !== '0' && <DetailsAmount label="Crédito no ciclo" amount={active.creditCents} />}
      </dl>
      <ul className="financial-rows">
        {data.detail.charges.map((charge) => <li key={`${charge.source}:${charge.id}`}>
          <div><strong>{charge.description}</strong>
            <small>{formatDate(charge.purchasedOn)}{charge.source === 'installment' && ` · Parcela ${charge.installmentNumber}/${charge.installmentCount}`}</small></div>
          <strong>{formatBrlCents(charge.amountCents)}</strong>
          <button type="button" className="ledger-quiet" disabled={charge.availableRefundCents === '0'}
            aria-label={`Estornar compra ${charge.description}`}
            onClick={() => setAction({ kind: 'refunds', invoice, charge })}>Estornar</button>
        </li>)}
        {data.detail.adjustments.map((adjustment) => <li key={adjustment.id}>
          <div><strong>{adjustment.description}</strong>
            <small>{formatDate(adjustment.occurredOn)}{adjustment.accountName && ` · ${adjustment.accountName}`}{adjustment.reversed && ' · Estornado'}</small></div>
          <strong>{formatBrlCents(adjustment.amountCents)}</strong>
          {adjustment.kind === 'payment' && !adjustment.reversed &&
            <button type="button" className="ledger-quiet" onClick={() => setAction({
              kind: 'payment-reversals', paymentId: adjustment.id, amountCents: adjustment.amountCents,
            })}>{actionTitles['payment-reversals']}</button>}
        </li>)}
      </ul>
      {!data.detail.charges.length && <p className="ledger-empty">Nenhuma compra neste ciclo.</p>}
    </section>}
    {action && <FinancialDialog action={action} props={props} dismiss={() => setAction(null)} />}
  </>
}

export function InvoicesView(props: InvoiceViewProps) {
  const { detail } = props.route
  return detail ? <InvoicePage key={`${detail.cardId}:${detail.month}`} {...props} detail={detail} /> : <InvoiceList {...props} />
}

export function CashView(props: ViewProps) {
  const [filter, setFilter] = useState(() => ({ ...currentMonthBounds(), accountId: '', page: 1 }))
  const [action, setAction] = useState<Action | null>(null)
  const query = new URLSearchParams({ from: filter.from, to: filter.to, page: String(filter.page) })
  if (filter.accountId) query.set('accountId', filter.accountId)
  const { data, feedback } = useReport<CashStatement>(`${props.url}/cash?${query}`, props.revision, props.expireSession)

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setFilter({ from: field(form, 'from'), to: field(form, 'to'), accountId: field(form, 'accountId'), page: 1 })
  }

  return <>
    <form className="ledger-surface financial-controls" onSubmit={apply}>
      <label>Conta<select name="accountId" defaultValue={filter.accountId}><option value="">Todas as contas</option>{accountOptions(props.catalog)}</select></label>
      <label>De<input name="from" type="date" required defaultValue={filter.from} /></label>
      <label>Até<input name="to" type="date" required defaultValue={filter.to} /></label>
      <button type="submit" className="ledger-quiet">Filtrar caixa</button>
      <button type="button" className="ledger-primary" disabled={props.catalog.accounts.length < 2}
        onClick={() => setAction({ kind: 'transfers', accountId: filter.accountId })}>{actionTitles.transfers}</button>
    </form>
    {feedback}
    {data && <section className="ledger-surface financial-detail" aria-label="Movimentações de caixa">
      <div className="ledger-section-heading"><h2>Movimentações efetivadas</h2><span>{data.count} movimentações</span></div>
      <dl className="financial-values cash-values">
        <DetailsAmount label="Receitas" amount={data.incomeCents} />
        <DetailsAmount label="Despesas" amount={data.expenseCents} />
        <DetailsAmount label="Pagamentos de fatura líquidos" amount={data.paidCents} />
        <DetailsAmount label="Transferências líquidas" amount={data.transferNetCents} />
        <DetailsAmount label="Variação de caixa" amount={data.netCents} />
      </dl>
      <ul className="financial-rows">
        {data.entries.map((entry) => <li key={`${entry.kind}:${entry.id}:${entry.accountId}`}>
          <div><strong>{entry.description}</strong><small>{formatDate(entry.occurredOn)} · {movementLabels[entry.kind]} · {entry.accountName}
            {entry.otherAccountName && ` · ${BigInt(entry.signedCents) < 0n ? 'Para' : 'De'} ${entry.otherAccountName}`}</small></div>
          <strong>{formatBrlCents(entry.signedCents)}</strong>
        </li>)}
      </ul>
      {!data.entries.length && <p className="ledger-empty">Nenhuma movimentação no período.</p>}
      {data.count > data.pageSize && <div className="ledger-pages">
        <button type="button" className="ledger-quiet" disabled={data.page === 1}
          onClick={() => setFilter({ ...filter, page: data.page - 1 })}>Anterior</button>
        <span>Página {data.page} de {Math.ceil(data.count / data.pageSize)}</span>
        <button type="button" className="ledger-quiet" disabled={data.page * data.pageSize >= data.count}
          onClick={() => setFilter({ ...filter, page: data.page + 1 })}>Próxima</button>
      </div>}
    </section>}
    {action && <FinancialDialog action={action} props={props} dismiss={() => setAction(null)} />}
  </>
}
