import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readConfig, readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'
import { createPrismaClient } from '../../src/server/database/prisma.ts'
import { nextScheduled, todayInBrasilia } from '../../src/server/ledger/recurrence-calendar.ts'

const migrator = new pg.Pool({
  connectionString: readPostgresUrl({ DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL }, 'DATABASE_MIGRATION_URL'),
})
const prisma = createPrismaClient(migrator)
const app = createApp(readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL }))
const origin = { host: '127.0.0.1:3107', origin: 'http://127.0.0.1:3107' }
const password = 'frase sintética de recorrências'
const card = randomUUID()
const newCard = randomUUID()
const account = randomUUID()

async function session(name: string) {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const { workspaceId } = await createLocalAccount(prisma, { username, password, displayName: name, workspaceName: name })
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin, payload: { username, password } })
  expect(login.statusCode).toBe(204)
  return { url: `/api/workspaces/${workspaceId}/ledger`, headers: { ...origin, cookie: String(login.headers['set-cookie']).split(';')[0] } }
}

let owner: Awaited<ReturnType<typeof session>>
let outsider: Awaited<ReturnType<typeof session>>
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

async function report(month: string) {
  const response = await get(`recurrences?month=${month}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}

const january = '2024-01-01'
const terms = { amountCents: 2400, accountId: null, endsOn: null, active: true }
const subscription = { ...terms, name: 'Assinatura A', kind: 'subscription', cadence: 'monthly', startsOn: '2024-01-31', cardId: card }

beforeAll(async () => {
  await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
  owner = await session('Agenda de recorrências')
  outsider = await session('Espaço isolado')
  for (const [id, name] of [[card, 'Pessoa A'], [newCard, 'Pessoa B']]) {
    const holderId = randomUUID()
    await create('holders', { id: holderId, name })
    await create('cards', { id, holderId, name: 'Cartão principal', closingDay: 25, dueDay: 8, limitCents: 90000 })
    if (id === card) await create('accounts', { id: account, holderId, name: 'Conta da Pessoa A', kind: 'bank',
      openingBalanceCents: 0, openingDate: january, includeInBalance: true })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
  await Promise.all([app.close(), migrator.end()])
})

it('altera cartão e valor só da vigência futura e mantém as ocorrências anteriores', async () => {
  const id = randomUUID()
  await create('recurrences', { ...subscription, id })
  const effectiveOn = nextScheduled(subscription.startsOn, 'monthly', todayInBrasilia())!
  expect((await post('recurrence-versions', { ...terms, id, effectiveOn: '2024-02-29', cardId: newCard })).statusCode).toBe(422)
  await create('recurrence-versions', { ...terms, id, effectiveOn, cardId: newCard, amountCents: 3500 })
  expect((await report(january)).occurrences).toContainEqual(expect.objectContaining({ seriesId: id, cardId: card, plannedCents: '2400' }))
  expect((await report(`${effectiveOn.slice(0, 7)}-01`)).occurrences).toContainEqual(expect.objectContaining({
    seriesId: id, scheduledOn: effectiveOn, cardId: newCard, plannedCents: '3500',
  }))
  expect((await report(january)).series).toContainEqual(expect.objectContaining({ id, next: expect.objectContaining({ cardId: newCard }) }))
})

it('muda a data de uma cobrança entre meses, pula e restaura sem alterar a série', async () => {
  const id = randomUUID()
  await create('recurrences', { ...subscription, id, name: 'Ocorrência variável', cardId: null, accountId: account, kind: 'expense' })
  const scheduledOn = '2024-01-31'
  await create('recurrence-occurrences', { id, scheduledOn, action: 'adjust', expectedOn: '2024-02-02', amountCents: 3000 })
  expect((await report(january)).occurrences.some((row: { seriesId: string }) => row.seriesId === id)).toBe(false)
  expect((await report('2024-02-01')).occurrences).toEqual(expect.arrayContaining([
    expect.objectContaining({ seriesId: id, scheduledOn, on: '2024-02-02', plannedCents: '3000' }),
    expect.objectContaining({ seriesId: id, scheduledOn: '2024-02-29', plannedCents: '2400' }),
  ]))
  await create('recurrence-occurrences', { id, scheduledOn, action: 'skip' })
  expect((await report(january)).occurrences).toContainEqual(expect.objectContaining({ seriesId: id, scheduledOn, skipped: true }))
  await create('recurrence-occurrences', { id, scheduledOn, action: 'restore' })
  expect((await report(january)).occurrences).toContainEqual(expect.objectContaining({ seriesId: id, scheduledOn, skipped: false, plannedCents: '2400' }))
})

it('concilia a cobrança real uma única vez e protege o histórico e os espaços financeiros', async () => {
  const id = randomUUID()
  const otherSeries = randomUUID()
  const scheduledOn = '2024-01-31'
  for (const series of [id, otherSeries]) await create('recurrences', { ...subscription, id: series, name: 'Assinatura para conciliar' })
  const entryId = randomUUID()
  const wrongCardEntry = randomUUID()
  for (const [entry, instrumentId] of [[entryId, card], [wrongCardEntry, newCard]]) {
    await create('entries', { id: entry, instrumentId, kind: 'purchase', description: 'Assinatura do extrato',
      amountCents: 2500, occurredOn: '2024-02-01' })
  }
  const cross = { ...outsider, url: owner.url }
  expect((await get(`recurrences?month=${january}`, cross)).statusCode).toBe(404)
  expect((await post('recurrence-occurrences', { id, scheduledOn, action: 'link', entryId }, cross)).statusCode).toBe(404)
  expect((await post('recurrence-occurrences', { id, scheduledOn, action: 'link', entryId: wrongCardEntry })).statusCode).toBe(422)
  const options = await get(`recurrence-candidates?id=${id}&scheduledOn=${scheduledOn}&search=extrato`)
  expect(options.json()).toMatchObject([{ id: entryId }])
  const concurrent = await Promise.all([id, otherSeries].map((seriesId) =>
    post('recurrence-occurrences', { id: seriesId, scheduledOn, action: 'link', entryId })))
  expect(concurrent.map((response) => response.statusCode).sort()).toEqual([201, 422])
  const linkedId = concurrent[0].statusCode === 201 ? id : otherSeries
  expect((await post('recurrence-occurrences', { id: linkedId, scheduledOn, action: 'skip' })).statusCode).toBe(409)
  expect((await report(january)).occurrences.some((row: { seriesId: string }) => row.seriesId === linkedId)).toBe(false)
  expect((await report('2024-02-01')).occurrences.filter((row: { entryId: string }) => row.entryId === entryId))
    .toMatchObject([{ seriesId: linkedId, scheduledOn, plannedCents: '2400', actualCents: '2500' }])
  expect((await get('entries?kind=purchase&from=2024-02-01&to=2024-02-01')).json().count).toBe(2)
})

it('valida meio de cobrança e data final e permite suspender uma série a partir do próximo ciclo', async () => {
  const id = randomUUID()
  const startsOn = todayInBrasilia()
  expect((await post('recurrences', { ...subscription, id, kind: 'income' })).statusCode).toBe(422)
  expect((await post('recurrences', { ...subscription, id, startsOn, endsOn: '2024-01-01' })).statusCode).toBe(422)
  await create('recurrences', { ...subscription, id, startsOn, cardId: null, accountId: account, kind: 'income', cadence: 'weekly' })
  await create('recurrence-versions', { ...terms, id, effectiveOn: startsOn, cardId: null, accountId: account, active: false })
  expect((await report(`${startsOn.slice(0, 7)}-01`)).series).toContainEqual(expect.objectContaining({ id, next: null }))
})
