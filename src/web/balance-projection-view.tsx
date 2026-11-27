import { useState } from 'react'
import type { FormEvent } from 'react'
import { currentMonthBounds, dateInBrasilia } from '../domain/date.ts'
import { formatBrlCents } from '../domain/money.ts'
import type { BalanceProjection } from '../server/database/balance-projection.ts'
import { useReport } from './financial-view.tsx'
import { formatDate } from './ledger-http.ts'

const sourceLabels = {
  opening: 'Saldo de abertura', recorded: 'Lançamento futuro registrado', invoice: 'Fatura em aberto',
  recurrence: 'Recorrência prevista', card_recurrence: 'Estimativa de recorrência no cartão',
}

type Movement = BalanceProjection['unassigned'][number]

function ProjectionRows({ movements }: { movements: Movement[] }) {
  return <ul className="financial-rows">
    {movements.map((item) => <li key={item.key}>
      <div><strong>{item.description}</strong><small>{sourceLabels[item.source]}
        {item.dueOn && item.dueOn < item.on && ` · Vencida em ${formatDate(item.dueOn)}`}</small></div>
      <strong>{formatBrlCents(item.cents)}</strong>
    </li>)}
  </ul>
}

export function BalanceProjectionView({ url, revision, expireSession }: {
  url: string; revision: number; expireSession: () => void
}) {
  const [to, setTo] = useState(() => currentMonthBounds().to)
  const [accountId, setAccountId] = useState('')
  const query = new URLSearchParams({ to })
  const { data, feedback } = useReport<BalanceProjection>(`${url}/balance-projection?${query}`, revision, expireSession)
  const account = data?.accounts.find((row) => row.id === accountId) ?? data?.accounts[0]
  const today = data?.today ?? dateInBrasilia()

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTo(String(new FormData(event.currentTarget).get('to')))
  }

  return <>
    <form className="ledger-surface financial-controls" onSubmit={apply}>
      <label>Conta<select value={account?.id ?? ''} disabled={!data?.accounts.length}
        onChange={(event) => setAccountId(event.target.value)}>
        {!data?.accounts.length && <option value="">Selecione uma conta</option>}
        {data?.accounts.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.holderName}</option>)}
      </select></label>
      <label>Projetar até<input name="to" type="date" min={today}
        defaultValue={to} required /></label>
      <button type="submit" className="ledger-quiet">Atualizar projeção</button>
    </form>
    {feedback}
    {data && !account && <p className="ledger-empty">Cadastre uma conta para projetar seu saldo.</p>}
    {data && account && <section className="ledger-surface financial-detail" aria-label="Saldo da conta">
      <div className="ledger-section-heading"><h2>{account.name}</h2><span>Até {formatDate(data.to)}</span></div>
      <dl className="financial-values">
        <div><dt>Saldo registrado em {formatDate(data.today)}</dt>
          <dd>{account.openingOn > data.today ? 'Conta ainda não aberta' : formatBrlCents(account.initialCents)}</dd></div>
        <div><dt>Saldo projetado em {formatDate(data.to)}</dt>
          <dd>{account.openingOn > data.to ? 'Conta ainda não aberta' : formatBrlCents(account.projectedCents)}</dd></div>
      </dl>
      {account.timeline.length === 0 && <p className="ledger-empty">Nenhuma movimentação prevista no período.</p>}
      {account.timeline.map((day) => <div key={day.on}>
        <div className="ledger-section-heading">
          <h3>{formatDate(day.on)}</h3><span>Saldo ao fim do dia {formatBrlCents(day.balanceCents)}</span>
        </div>
        <ProjectionRows movements={day.movements} />
      </div>)}
    </section>}
    {!!data?.unassigned.length && <section className="ledger-surface financial-detail" aria-label="Previsões sem conta">
      <h2>Previsões sem conta no período</h2>
      <p>Estas previsões não entram no saldo das contas.</p>
      {data.unassigned.map((item) => <div key={item.key}>
        <h3>{formatDate(item.on)}</h3><ProjectionRows movements={[item]} />
      </div>)}
    </section>}
  </>
}
