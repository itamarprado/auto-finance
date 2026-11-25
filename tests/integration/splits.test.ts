import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readConfig, readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'
import { createPrismaClient } from '../../src/server/database/prisma.ts'

const migrator = new pg.Pool({
  connectionString: readPostgresUrl({ DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL }, 'DATABASE_MIGRATION_URL'),
})
const prisma = createPrismaClient(migrator)
const app = createApp(readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL }))
const origin = { host: '127.0.0.1:3107', origin: 'http://127.0.0.1:3107' }
const password = 'frase sintética de rateios'

async function session(name: string) {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const { workspaceId } = await createLocalAccount(prisma, { username, password, displayName: name, workspaceName: name })
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin, payload: { username, password } })
  expect(response.statusCode).toBe(204)
  return { url: `/api/workspaces/${workspaceId}/ledger`, headers: { ...origin, cookie: String(response.headers['set-cookie']).split(';')[0] } }
}

let owner: Awaited<ReturnType<typeof session>>
let outsider: Awaited<ReturnType<typeof session>>
const payerId = randomUUID()
const participantId = randomUUID()
const payerAccount = randomUUID()
const participantAccount = randomUUID()
const cardId = randomUUID()

function post(path: string, payload: object, actor = owner) {
  return app.inject({ method: 'POST', url: `${actor.url}/${path}`, headers: actor.headers, payload })
}

function get(path: string, actor = owner) {
  return app.inject({ url: `${actor.url}/${path}`, headers: actor.headers })
}

async function create(path: string, payload: object) {
  const response = await post(path, payload)
  expect(response.statusCode, response.body).toBe(201)
}

async function movement(kind: 'purchase' | 'income' | 'expense', amountCents: number, occurredOn: string, instrumentId: string) {
  const id = randomUUID()
  await create('entries', { id, kind, instrumentId, description: `Movimento de teste ${kind}`, amountCents, occurredOn })
  return { source: 'entry' as const, id }
}

function splitPayload(entry: { source: 'entry' | 'plan'; id: string }) {
  return { id: randomUUID(), origin: entry, payerId, mode: 'equal',
    shares: [{ holderId: payerId }, { holderId: participantId }] }
}

async function findSplit(id: string) {
  const response = await get('splits')
  expect(response.statusCode, response.body).toBe(200)
  return response.json().items.find((split: { id: string }) => split.id === id)
}

beforeAll(async () => {
  await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
  owner = await session('Espaço dos rateios')
  outsider = await session('Espaço sem acesso ao rateio')
  for (const [id, name] of [[payerId, 'Pessoa pagadora'], [participantId, 'Pessoa participante']]) {
    await create('holders', { id, name })
  }
  for (const [id, holderId] of [[payerAccount, payerId], [participantAccount, participantId]]) {
    await create('accounts', { id, holderId, name: `Conta ${id.slice(0, 4)}`, kind: 'bank',
      openingBalanceCents: 0, openingDate: '2024-01-01', includeInBalance: true })
  }
  await create('cards', { id: cardId, holderId: payerId, name: 'Cartão dos rateios', closingDay: 25, dueDay: 8, limitCents: 100000 })
})

afterAll(async () => {
  await prisma.$disconnect()
  await Promise.all([app.close(), migrator.end()])
})

it('mantém uma cobrança na fatura e concilia duas parcelas de reembolso sem gerar receita', async () => {
  const purchase = await movement('purchase', 24000, '2024-06-10', cardId)
  const payload = splitPayload(purchase)
  await create('splits', payload)
  expect((await post('splits', { ...payload, id: randomUUID() })).statusCode).toBe(409)
  const first = await movement('income', 5000, '2024-06-11', payerAccount)
  const second = await movement('income', 7000, '2024-06-12', payerAccount)
  for (const [receipt, amountCents, openCents] of [[first, 5000, '7000'], [second, 7000, '0']] as const) {
    await create('settlements', { id: randomUUID(), origin: receipt, fromHolderId: participantId, toHolderId: payerId,
      allocations: [{ splitId: payload.id, holderId: participantId, amountCents }] })
    expect((await findSplit(payload.id)).shares).toContainEqual(expect.objectContaining({ holderId: participantId, responsibilityCents: '12000', openCents }))
  }
  const invoice = (await get(`invoices?cycleMonth=2024-06-01&cardId=${cardId}`)).json().detail
  expect(invoice.charges).toMatchObject([{ id: purchase.id, amountCents: '24000' }])
  expect((await get('monthly?month=2024-06-01')).json()).toMatchObject({
    statement: { purchaseCents: '24000', incomeCents: '0' }, cash: { netCents: '12000', reimbursementNetCents: '12000' },
  })
  expect((await get('entries?kind=reimbursement_in&from=2024-06-01&to=2024-06-30')).json().count).toBe(2)
})

it('valida quantias, participantes e isolamento de espaço antes de gravar', async () => {
  const purchase = await movement('expense', 3000, '2024-07-04', payerAccount)
  const payload = splitPayload(purchase)
  const outsiderAgainstOwner = { ...outsider, url: owner.url }
  expect((await get('splits', outsiderAgainstOwner)).statusCode).toBe(404)
  expect((await post('splits', payload, outsiderAgainstOwner)).statusCode).toBe(404)
  expect((await get('splits', outsider)).json()).toEqual({ items: [], hasNext: false })
  expect((await post('splits', payload, outsider)).statusCode).toBe(422)
  expect((await post('splits', { ...payload, shares: [{ holderId: payerId }, { holderId: payerId.toUpperCase() }] })).statusCode).toBe(422)
  expect((await post('splits', { ...payload, mode: 'fixed', shares: [
    { holderId: payerId, amountCents: 1000 }, { holderId: participantId, amountCents: 1500 },
  ] })).statusCode).toBe(422)
  expect((await findSplit(payload.id))).toBeUndefined()
})

it('vincula uma transferência a dois rateios uma vez e rejeita uma segunda conciliação concorrente', async () => {
  const expenses = await Promise.all([movement('expense', 4000, '2024-08-10', payerAccount), movement('expense', 6000, '2024-08-11', payerAccount)])
  const splits = expenses.map(splitPayload)
  for (const split of splits) await create('splits', split)
  const id = randomUUID()
  await create('transfers', { id, occurredOn: '2024-08-12', description: 'PIX entre participantes',
    accountId: participantAccount, destinationId: payerAccount, amountCents: 5000 })
  const direction = `fromHolderId=${participantId}&toHolderId=${payerId}`
  expect((await get(`settlement-sources?${direction}&search=PIX`)).json().items).toMatchObject([{ id, source: 'transfer' }])
  const payload = { origin: { source: 'transfer', id }, fromHolderId: participantId, toHolderId: payerId,
    allocations: splits.map((split, index) => ({ splitId: split.id, holderId: participantId, amountCents: index === 0 ? 2000 : 3000 })) }
  const responses = await Promise.all([post('settlements', { ...payload, id: randomUUID() }), post('settlements', { ...payload, id: randomUUID() })])
  expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409])
  for (const split of splits) expect((await findSplit(split.id)).shares).toContainEqual(expect.objectContaining({ holderId: participantId, openCents: '0' }))
  const cash = (await get('cash?from=2024-08-01&to=2024-08-31')).json()
  expect(cash).toMatchObject({ expenseCents: '10000', incomeCents: '0', netCents: '-10000', reimbursementNetCents: '0' })
  expect(cash.entries.filter((entry: { kind: string }) => entry.kind === 'reimbursement')).toHaveLength(2)
})

it('recalcula uma compra parcelada com partes fixas e conserva o histórico após devolver o excesso', async () => {
  const id = randomUUID()
  await create('installments', { id, cardId, description: 'Compra parcelada compartilhada', amountCents: 24000,
    occurredOn: '2024-09-10', installmentCount: 2 })
  const payload = { ...splitPayload({ source: 'plan', id }), mode: 'fixed',
    shares: [{ holderId: payerId, amountCents: 18000 }, { holderId: participantId, amountCents: 6000 }] }
  await create('splits', payload)
  const receipt = await movement('income', 6000, '2024-09-11', payerAccount)
  const original = { splitId: payload.id, holderId: participantId, amountCents: 6000 }
  await create('settlements', { id: randomUUID(), origin: receipt, fromHolderId: participantId, toHolderId: payerId, allocations: [original] })
  await create('refunds', { id: randomUUID(), cardId, cycleMonth: '2024-09-01', amountCents: 12000,
    occurredOn: '2024-09-12', chargeId: id, source: 'installment' })
  expect(await findSplit(payload.id)).toMatchObject({ netCents: '12000', shares: expect.arrayContaining([
    expect.objectContaining({ holderId: participantId, responsibilityCents: '3000', openCents: '-3000' }),
  ]) })
  const compensation = await movement('expense', 3000, '2024-09-13', payerAccount)
  await create('settlements', { id: randomUUID(), origin: compensation, fromHolderId: payerId, toHolderId: participantId,
    allocations: [{ ...original, amountCents: 3000 }] })
  expect((await findSplit(payload.id)).shares).toContainEqual(expect.objectContaining({
    holderId: participantId, openCents: '0', settlements: [
      expect.objectContaining({ amountCents: '6000', compensating: false }),
      expect.objectContaining({ amountCents: '3000', compensating: true }),
    ],
  }))
})
