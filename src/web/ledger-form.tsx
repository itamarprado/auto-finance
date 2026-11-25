import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { dateInBrasilia } from '../domain/date.ts'
import { parseBrlCents } from '../domain/money.ts'
import type { AccountInput, CardInput, EntryInput, HolderInput, LedgerCatalog } from '../server/database/ledger.ts'

export type LedgerSection = 'entries' | 'holders' | 'accounts' | 'cards'
type NewRecord = HolderInput | AccountInput | CardInput | EntryInput

export const sectionLabels = { entries: 'Extrato', holders: 'Titulares', accounts: 'Contas', cards: 'Cartões' }
export const formLabels = { entries: 'Novo lançamento', holders: 'Novo titular', accounts: 'Nova conta', cards: 'Novo cartão' }
export const entryLabels = {
  income: 'Receita', expense: 'Despesa', purchase: 'Compra no cartão', refund: 'Estorno no cartão',
  reimbursement_in: 'Reembolso recebido', reimbursement_out: 'Reembolso enviado',
}

export function field(data: FormData, name: string): string {
  return String(data.get(name) ?? '').trim()
}

function recordFromForm(data: FormData, section: LedgerSection, id: string): NewRecord {
  if (section === 'entries') {
    const kind = field(data, 'kind') as EntryInput['kind']
    const amountCents = parseBrlCents(field(data, 'amount'))
    if (amountCents <= 0) throw new Error('Informe um valor maior que zero.')
    return {
      id, kind, description: field(data, 'description'), instrumentId: field(data, 'instrumentId'),
      amountCents, occurredOn: field(data, 'occurredOn'),
    }
  }

  const name = field(data, 'name')
  const holderId = field(data, 'holderId')

  if (section === 'holders') return { id, name }
  if (section === 'accounts') {
    return {
      id, name, holderId, kind: field(data, 'kind') as AccountInput['kind'],
      openingDate: field(data, 'openingDate'), openingBalanceCents: parseBrlCents(field(data, 'openingBalance')),
      includeInBalance: data.has('includeInBalance'),
    }
  }
  const limitCents = parseBrlCents(field(data, 'limit'))
  if (limitCents < 0) throw new Error('Informe um limite igual ou maior que zero.')
  return {
    id, name, holderId, paymentAccountId: field(data, 'paymentAccountId') || undefined,
    lastFour: field(data, 'lastFour') || undefined, limitCents,
    closingDay: Number(field(data, 'closingDay')), dueDay: Number(field(data, 'dueDay')),
  }
}

export function LedgerForm({ section, catalog, dismiss, save }: {
  section: LedgerSection
  catalog: LedgerCatalog
  dismiss: () => void
  save: (record: NewRecord) => Promise<void>
}) {
  const [kind, setKind] = useState<EntryInput['kind']>(catalog.accounts.length ? 'expense' : 'purchase')
  const instruments = kind === 'purchase' ? catalog.cards : catalog.accounts

  return (
    <RecordDialog title={formLabels[section]} dismiss={dismiss}
      save={(fields, id) => save(recordFromForm(fields, section, id))}>
        {section === 'entries' ? (
          <>
            <label>Descrição<input name="description" maxLength={160} required /></label>
            <div className="ledger-fields">
              <label>Tipo de lançamento
                <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as EntryInput['kind'])}>
                  <option value="income" disabled={!catalog.accounts.length}>Receita</option>
                  <option value="expense" disabled={!catalog.accounts.length}>Despesa</option>
                  <option value="purchase" disabled={!catalog.cards.length}>Compra no cartão</option>
                </select>
              </label>
              <label>{kind === 'purchase' ? 'Cartão' : 'Conta'}
                <select name="instrumentId" key={kind} defaultValue="" required>
                  <option value="" disabled>Selecione</option>
                  {instruments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Valor em reais<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
              <label>Data do lançamento<input type="date" name="occurredOn" defaultValue={dateInBrasilia()} required /></label>
            </div>
          </>
        ) : (
          <>
            <label>Nome<input name="name" maxLength={120} required /></label>
            {section !== 'holders' && <label>Titular
              <select name="holderId" defaultValue="" required>
                <option value="" disabled>Selecione</option>
                {catalog.holders.map((holder) => <option key={holder.id} value={holder.id}>{holder.name}</option>)}
              </select>
            </label>}
            {section === 'accounts' && (
              <>
                <label>Tipo de conta<select name="kind"><option value="bank">Conta bancária</option><option value="cash">Carteira</option></select></label>
                <div className="ledger-fields">
                  <label>Saldo inicial em reais<input name="openingBalance" inputMode="decimal" defaultValue="0,00" required /></label>
                  <label>Data do saldo inicial<input type="date" name="openingDate" defaultValue={dateInBrasilia()} required /></label>
                </div>
                <label className="ledger-checkbox"><input type="checkbox" name="includeInBalance" defaultChecked /> Incluir no saldo consolidado</label>
              </>
            )}
            {section === 'cards' && (
              <>
                <label>Conta pagadora
                  <select name="paymentAccountId" defaultValue="">
                    <option value="">Sem vínculo</option>
                    {catalog.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
                <div className="ledger-fields">
                  <label>Final do cartão (opcional)<input name="lastFour" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="4 dígitos" /></label>
                  <label>Limite em reais<input name="limit" inputMode="decimal" defaultValue="0,00" required /></label>
                  <label>Dia de fechamento<input type="number" name="closingDay" min={1} max={31} required /></label>
                  <label>Dia de vencimento<input type="number" name="dueDay" min={1} max={31} required /></label>
                </div>
              </>
            )}
          </>
        )}
    </RecordDialog>
  )
}

export function RecordDialog({ title, dismiss, save, children }: {
  title: string
  dismiss: () => void
  save: (fields: FormData, id: string) => Promise<void>
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [id] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => { node?.close() }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await save(new FormData(event.currentTarget), id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog className="ledger-dialog" ref={dialog} aria-labelledby="ledger-form-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) dismiss() }}>
      <header>
        <h2 id="ledger-form-title">{title}</h2>
        <button type="button" className="ledger-quiet" onClick={dismiss} disabled={saving} aria-label="Fechar">×</button>
      </header>
      {error && <p className="notice" role="alert">{error}</p>}
      <form method="post" onSubmit={(event) => { void submit(event) }}>
        {children}
        <footer>
          <button type="button" className="ledger-quiet" onClick={dismiss} disabled={saving}>Cancelar</button>
          <button type="submit" className="ledger-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </footer>
      </form>
    </dialog>
  )
}
