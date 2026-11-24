import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readConfig, readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'

const migrator = new pg.Pool({
  connectionString: readPostgresUrl(
    { DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL }, 'DATABASE_MIGRATION_URL',
  ),
})
const app = createApp(readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL }))
const local = { host: '127.0.0.1:3107', origin: 'http://127.0.0.1:3107' }
const password = 'Frase sintética exclusiva para o extrato'

async function fixture(displayName: string) {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const { workspaceId } = await createLocalAccount(migrator, {
    username, displayName, workspaceName: displayName, password,
  })
  const login = await app.inject({
    method: 'POST', url: '/api/auth/login', headers: local, payload: { username, password },
  })
  expect(login.statusCode).toBe(204)
  const cookie = String(login.headers['set-cookie']).split(';')[0]
  return { url: `/api/workspaces/${workspaceId}/ledger`, headers: { ...local, cookie } }
}

let owner: Awaited<ReturnType<typeof fixture>>
let outsider: Awaited<ReturnType<typeof fixture>>
const holderId = randomUUID()
const secondHolderId = randomUUID()
const accountId = randomUUID()
const cardId = randomUUID()

function post(workspace: typeof owner, resource: string, payload: object) {
  return app.inject({ method: 'POST', url: `${workspace.url}/${resource}`, headers: workspace.headers, payload })
}

function get(workspace: typeof owner, resource: string) {
  return app.inject({ url: `${workspace.url}/${resource}`, headers: workspace.headers })
}

beforeAll(async () => {
  await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
  owner = await fixture('Espaço do extrato')
  outsider = await fixture('Outro espaço do extrato')
  for (const [id, name] of [[holderId, 'Titular da conta'], [secondHolderId, 'Titular do cartão']]) {
    expect((await post(owner, 'holders', { id, name })).statusCode).toBe(201)
  }
  expect((await post(owner, 'accounts', {
    id: accountId, holderId, name: 'Conta principal', kind: 'bank',
    openingBalanceCents: 100000, openingDate: '2020-02-01', includeInBalance: true,
  })).statusCode).toBe(201)
  expect((await post(owner, 'cards', {
    id: cardId, holderId: secondHolderId, name: 'Cartão de teste', lastFour: '0024',
    paymentAccountId: accountId, limitCents: 300000, closingDay: 24, dueDay: 6,
  })).statusCode).toBe(201)
})

afterAll(async () => { await Promise.all([app.close(), migrator.end()]) })

describe('cadastros e extrato', () => {
  it('calcula saldo e totais do filtro com valores exatos, usando titular e origem de cada linha', async () => {
    const drafts = [
      { id: randomUUID(), kind: 'income', instrumentId: accountId, description: 'Histórico anterior', amountCents: 9000, occurredOn: '2020-01-31' },
      { id: randomUUID(), kind: 'income', instrumentId: accountId, description: 'Receita de teste', amountCents: 20000, occurredOn: '2020-03-04' },
      { id: randomUUID(), kind: 'expense', instrumentId: accountId, description: 'Despesa de teste', amountCents: 3501, occurredOn: '2020-03-05' },
      { id: randomUUID(), kind: 'purchase', instrumentId: cardId, description: 'Compra de teste', amountCents: 2189, occurredOn: '2020-03-06' },
      { id: randomUUID(), kind: 'income', instrumentId: accountId, description: 'Receita futura', amountCents: 5000, occurredOn: '9999-04-01' },
    ]
    for (const draft of drafts) expect((await post(owner, 'entries', draft)).statusCode).toBe(201)

    const catalog = await get(owner, 'catalog')
    expect(catalog.statusCode).toBe(200)
    expect(catalog.json().accounts).toEqual([expect.objectContaining({ id: accountId, balanceCents: '116499' })])
    expect(catalog.json().cards).toEqual([expect.objectContaining({
      id: cardId, holderId: secondHolderId, lastFour: '0024', paymentAccountId: accountId,
    })])

    const period = await get(owner, 'entries?from=2020-03-01&to=2020-03-31')
    expect(period.statusCode).toBe(200)
    expect(period.json()).toMatchObject({ count: 3, incomeCents: '20000', expenseCents: '3501', purchaseCents: '2189' })
    expect(period.json().entries).toMatchObject([
      { instrumentName: 'Cartão de teste', holderName: 'Titular do cartão', amountCents: '2189' },
      { instrumentName: 'Conta principal', holderName: 'Titular da conta', amountCents: '3501' },
      { instrumentName: 'Conta principal', holderName: 'Titular da conta', amountCents: '20000' },
    ])
    const cardOnly = await get(owner, `entries?cardId=${cardId}&search=compra`)
    expect(cardOnly.json()).toMatchObject({ count: 1, expenseCents: '0', purchaseCents: '2189' })
    const expenses = await get(owner, `entries?accountId=${accountId}&kind=expense`)
    expect(expenses.json()).toMatchObject({ count: 1, expenseCents: '3501', purchaseCents: '0' })
  })

  it('recusa acesso fora do espaço, vínculo de outro espaço e gravação sem origem', async () => {
    const noSession = await app.inject({ url: `${owner.url}/catalog`, headers: local })
    expect(noSession.statusCode).toBe(401)
    const otherSession = await app.inject({ url: `${owner.url}/catalog`, headers: outsider.headers })
    expect(otherSession.statusCode).toBe(404)
    expect(otherSession.headers['cache-control']).toBe('no-store')
    const wrongLink = await post(outsider, 'entries', {
      id: randomUUID(), kind: 'purchase', instrumentId: cardId, description: 'Registro sintético',
      amountCents: 10, occurredOn: '2020-04-01',
    })
    expect(wrongLink.statusCode).toBe(422)
    const noOrigin = await app.inject({
      method: 'POST', url: `${owner.url}/holders`, headers: { host: local.host, cookie: owner.headers.cookie },
      payload: { id: randomUUID(), name: 'Titular sintético' },
    })
    expect(noOrigin.statusCode).toBe(403)
    expect((await get(outsider, 'entries')).json()).toMatchObject({ count: 0, entries: [] })
  })

  it('recusa datas inválidas e finais de cartão com mais de quatro dígitos', async () => {
    expect((await get(owner, 'entries?from=2020-02-30')).statusCode).toBe(422)
    expect((await get(owner, 'entries?from=2020-04-01&to=2020-03-01')).statusCode).toBe(422)
    const invalidCard = await post(owner, 'cards', {
      id: randomUUID(), holderId, name: 'Cartão sintético', lastFour: '00000',
      limitCents: 9999, closingDay: 5, dueDay: 10,
    })
    expect(invalidCard.statusCode).toBe(400)
  })

  it('grava uma vez em reenvios concorrentes e preserva lançamentos legítimos iguais', async () => {
    const entry = {
      id: randomUUID(), kind: 'expense', instrumentId: accountId, description: 'Paginação sintética',
      amountCents: 101, occurredOn: '2021-01-01',
    }
    const sent = await Promise.all([post(owner, 'entries', entry), post(owner, 'entries', entry)])
    expect(sent.map((result) => result.statusCode).sort()).toEqual([201, 409])
    const additional = await Promise.all(Array.from({ length: 25 }, () => post(owner, 'entries', { ...entry, id: randomUUID() })))
    expect(additional.every((result) => result.statusCode === 201)).toBe(true)
    const first = (await get(owner, 'entries?from=2021-01-01&to=2021-01-01')).json()
    const next = (await get(owner, 'entries?from=2021-01-01&to=2021-01-01&page=2')).json()
    expect(first).toMatchObject({ count: 26, expenseCents: '2626', page: 1 })
    expect(next).toMatchObject({ count: 26, expenseCents: '2626', page: 2 })
    expect(first.entries).toHaveLength(25)
    expect(next.entries).toHaveLength(1)
    expect(new Set([...first.entries, ...next.entries].map((item) => item.id)).size).toBe(26)
  })
})
