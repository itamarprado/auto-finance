import { useState } from 'react'
import { formatBrlCents, parseBrlCents } from '../domain/money.ts'
import type { LedgerCatalog } from '../server/database/ledger.ts'
import type { ReceiptSource, SplitSource, SplitSummary } from '../server/database/splits.ts'
import { useReport } from './financial-view.tsx'
import { field, RecordDialog } from './ledger-form.tsx'
import { formatDate, LedgerError, ledgerRequest } from './ledger-http.ts'

interface SplitProps {
  url: string
  catalog: LedgerCatalog
  revision: number
  saved: () => void
  expireSession: () => void
}

type Page<T> = { items: T[]; hasNext: boolean }
type Share = SplitSummary['shares'][number]
type Balance = { split: SplitSummary; share: Share; fromHolderId: string; toHolderId: string; available: bigint }

function movementKey(movement: SplitSource | ReceiptSource) {
  return `${movement.source}:${movement.id}`
}

function Pagination({ page, hasNext, change }: { page: number; hasNext: boolean; change: (page: number) => void }) {
  if (page === 1 && !hasNext) return null
  return <div className="ledger-pages">
    <button type="button" className="ledger-quiet" disabled={page === 1} onClick={() => change(page - 1)}>Anterior</button>
    <span>Página {page}</span>
    <button type="button" className="ledger-quiet" disabled={!hasNext} onClick={() => change(page + 1)}>Próxima</button>
  </div>
}

function MovementPicker<T extends SplitSource | ReceiptSource>({ url, revision, expireSession, selected, select, label, empty }: {
  url: string; revision: number; expireSession: () => void; selected?: T; select: (movement: T) => void
  label: string; empty: string
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = new URLSearchParams({ page: String(page), search })
  const { data, feedback } = useReport<Page<T>>(`${url}${url.includes('?') ? '&' : '?'}${query}`, revision, expireSession)
  const available = data?.items ?? []
  const options = selected && !available.some((movement) => movementKey(movement) === movementKey(selected))
    ? [selected, ...available] : available
  return <div className="split-movement-picker">
    <label>Buscar por descrição<input value={search} maxLength={160} onChange={(event) => {
      setSearch(event.target.value)
      setPage(1)
    }} /></label>
    {feedback}
    <label>{label}<select value={selected ? movementKey(selected) : ''} required onChange={(event) => {
      const movement = options.find((item) => movementKey(item) === event.target.value)
      if (movement) select(movement)
    }}>
      <option value="" disabled>Selecione</option>
      {options.map((movement) => <option key={movementKey(movement)} value={movementKey(movement)}>
        {movement.description} · {movement.instrument} · {formatDate(movement.occurredOn)} · {formatBrlCents(movement.amountCents)}
      </option>)}
    </select></label>
    {data && !available.length && <p className="financial-context">{empty}</p>}
    {data && <Pagination page={page} hasNext={data.hasNext} change={setPage} />}
  </div>
}

function SplitDialog({ props, dismiss, write }: {
  props: SplitProps; dismiss: () => void; write: (endpoint: string, record: object) => Promise<void>
}) {
  const [movement, setMovement] = useState<SplitSource>()
  const [payer, setPayer] = useState('')
  const [mode, setMode] = useState<'equal' | 'fixed'>('equal')
  const [participants, setParticipants] = useState<string[]>([])
  const holders = props.catalog.holders

  return <RecordDialog title="Novo rateio" dismiss={dismiss} save={async (fields, id) => {
    if (!movement) throw new Error('Selecione a despesa que será rateada.')
    if (participants.length < 2 || participants.length > 25) throw new Error('Selecione de 2 a 25 participantes.')
    const shares = participants.map((holderId) => ({
      holderId, amountCents: mode === 'fixed' ? parseBrlCents(field(fields, holderId)) : undefined,
    }))
    await write('splits', { id, origin: { id: movement.id, source: movement.source }, payerId: payer || movement.holderId, mode, shares })
  }}>
    <MovementPicker<SplitSource> url={`${props.url}/split-sources`} revision={props.revision} expireSession={props.expireSession}
      selected={movement} select={setMovement} label="Despesa original" empty="Nenhuma despesa disponível para esta busca." />
    <div className="ledger-fields">
      <label>Quem pagou<select value={payer || movement?.holderId || ''} required onChange={(event) => setPayer(event.target.value)}>
        <option value="" disabled>Selecione</option>
        {holders.map((holder) => <option value={holder.id} key={holder.id}>{holder.name}</option>)}
      </select></label>
      <label>Divisão<select value={mode} onChange={(event) => setMode(event.target.value === 'fixed' ? 'fixed' : 'equal')}>
        <option value="equal">Partes iguais</option><option value="fixed">Valores definidos</option>
      </select></label>
    </div>
    <fieldset className="split-fields"><legend>Participantes</legend>
      {holders.map((holder) => <div className="split-participant" key={holder.id}>
        <label className="ledger-checkbox">
          <input type="checkbox" checked={participants.includes(holder.id)} onChange={(event) => {
            const checked = event.target.checked
            setParticipants((previous) => checked ? [...previous, holder.id] : previous.filter((id) => id !== holder.id))
          }} /> {holder.name}
        </label>
        {mode === 'fixed' && participants.includes(holder.id) &&
          <label>Parte de {holder.name} em reais<input name={holder.id} inputMode="decimal" placeholder="0,00" required /></label>}
      </div>)}
    </fieldset>
  </RecordDialog>
}

function balanceOf(split: SplitSummary, share: Share): Balance {
  const open = BigInt(share.openCents)
  return open >= 0n
    ? { split, share, fromHolderId: share.holderId, toHolderId: split.payerId, available: open }
    : { split, share, fromHolderId: split.payerId, toHolderId: share.holderId, available: -open }
}

function SettlementDialog({ props, balances, chosen, dismiss, write }: {
  props: SplitProps; balances: Balance[]; chosen: Balance; dismiss: () => void
  write: (endpoint: string, record: object) => Promise<void>
}) {
  const [movement, setMovement] = useState<ReceiptSource>()
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const { fromHolderId, toHolderId } = chosen
  const candidates = [chosen, ...balances.filter((balance) => balance !== chosen && balance.fromHolderId === fromHolderId
    && balance.toHolderId === toHolderId && balance.available > 0n)]
  const keyFor = (balance: Balance) => `${balance.split.id}:${balance.share.holderId}`
  const person = (id: string) => props.catalog.holders.find((holder) => holder.id === id)?.name

  return <RecordDialog title="Conciliar reembolso" dismiss={dismiss} save={async (_fields, id) => {
    if (!movement) throw new Error('Selecione a movimentação do reembolso.')
    const allocations = candidates.flatMap((balance) => {
      const entered = amounts[keyFor(balance)]?.trim()
      if (!entered) return []
      const amountCents = parseBrlCents(entered)
      if (amountCents <= 0 || BigInt(amountCents) > balance.available) throw new Error('O valor deve caber no saldo em aberto.')
      return [{ splitId: balance.split.id, holderId: balance.share.holderId, amountCents }]
    })
    if (allocations.reduce((sum, allocation) => sum + BigInt(allocation.amountCents), 0n) !== BigInt(movement.amountCents)) {
      throw new Error('Distribua o valor integral da movimentação entre os rateios selecionados.')
    }
    await write('settlements', { id, origin: { id: movement.id, source: movement.source }, fromHolderId, toHolderId, allocations })
  }}>
    <p className="financial-context">De <strong>{person(fromHolderId)}</strong> para <strong>{person(toHolderId)}</strong></p>
    <MovementPicker<ReceiptSource> url={`${props.url}/settlement-sources?${new URLSearchParams({ fromHolderId, toHolderId })}`}
      revision={props.revision} expireSession={props.expireSession} selected={movement} select={(next) => {
        setMovement(next)
        const cents = BigInt(next.amountCents) < chosen.available ? BigInt(next.amountCents) : chosen.available
        setAmounts({ [keyFor(chosen)]: `${cents / 100n},${String(cents % 100n).padStart(2, '0')}` })
      }} label="Movimentação do reembolso"
      empty="Se o valor já foi pago, registre-o no Extrato ou como transferência no Fluxo de caixa e volte para conciliá-lo." />
    <fieldset className="split-fields"><legend>Valores a conciliar em reais</legend>
      {candidates.map((balance) => <label key={keyFor(balance)}>
        {balance.split.description} · {formatDate(balance.split.occurredOn)} · saldo {formatBrlCents(balance.available)}
        <input inputMode="decimal" placeholder="0,00" value={amounts[keyFor(balance)] ?? ''}
          onChange={(event) => setAmounts({ ...amounts, [keyFor(balance)]: event.target.value })} />
      </label>)}
    </fieldset>
  </RecordDialog>
}

export function SplitsView(props: SplitProps) {
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [target, setTarget] = useState<{ chosen: Balance; balances: Balance[] }>()
  const { data, feedback } = useReport<Page<SplitSummary>>(`${props.url}/splits?page=${page}`, props.revision, props.expireSession)
  const balances = data?.items.flatMap((split) => split.shares.map((share) => balanceOf(split, share))) ?? []
  const dismiss = () => { setAdding(false); setTarget(undefined) }

  async function write(endpoint: string, record: object) {
    try {
      await ledgerRequest(`${props.url}/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
      dismiss()
      if (endpoint === 'splits') setPage(1)
      props.saved()
    } catch (error) {
      if (error instanceof LedgerError && error.status === 401) props.expireSession()
      throw error
    }
  }

  return <>
    <section className="ledger-surface financial-detail" aria-label="Rateios registrados">
      <div className="ledger-section-heading">
        <h2>Despesas compartilhadas</h2>
        <button type="button" className="ledger-primary" onClick={() => setAdding(true)} disabled={props.catalog.holders.length < 2}>Novo rateio</button>
      </div>
      {props.catalog.holders.length < 2 && <p className="ledger-empty">Cadastre pelo menos dois titulares para dividir uma despesa.</p>}
      {feedback}
      {data && !data.items.length && <p className="ledger-empty">Nenhum rateio registrado.</p>}
      {data?.items.map((split) => <article className="split-card" key={split.id}>
        <div className="split-heading">
          <div><h3>{split.description}</h3><small>{formatDate(split.occurredOn)} · Pago por {split.payerName}</small></div>
          <strong>{formatBrlCents(split.netCents)}</strong>
        </div>
        {split.netCents !== split.originalCents && <p className="financial-context">Valor original {formatBrlCents(split.originalCents)}. Partes recalculadas após estorno.</p>}
        <ul className="financial-rows">
          {balances.filter((balance) => balance.split.id === split.id).map((balance) => {
            const { share } = balance
            const settled = share.openCents === '0'
            return <li key={share.holderId}>
              <div>
                <strong>{share.holderName} · {formatBrlCents(share.responsibilityCents)}</strong>
                {share.holderId === split.payerId ? <small>Parte de quem pagou</small>
                  : <small>{settled ? 'Quitado' : `${BigInt(share.openCents) > 0n ? 'Falta pagar' : 'Tem a receber'} ${formatBrlCents(balance.available)}`}</small>}
                {share.settlements.map((settlement) => <small key={settlement.id}>
                  {settlement.compensating ? 'Devolução' : 'Reembolso'} · {formatDate(settlement.occurredOn)} · {formatBrlCents(settlement.amountCents)} · {settlement.description}
                </small>)}
              </div>
              {!settled && <button type="button" className="ledger-quiet" aria-label={`Conciliar reembolso de ${share.holderName} em ${split.description}`}
                onClick={() => setTarget({ chosen: balance, balances })}>Conciliar reembolso</button>}
            </li>
          })}
        </ul>
      </article>)}
      {data && <Pagination page={page} hasNext={data.hasNext} change={setPage} />}
    </section>
    {adding && <SplitDialog props={props} write={write} dismiss={dismiss} />}
    {target && <SettlementDialog props={props} {...target} write={write} dismiss={dismiss} />}
  </>
}
