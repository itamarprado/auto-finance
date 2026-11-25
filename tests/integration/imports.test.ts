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
const password = 'Credencial sintética para importação'

async function fixture(name: string) {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const { workspaceId } = await createLocalAccount(prisma, { username, password, displayName: name, workspaceName: name })
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers: origin, payload: { username, password } })
  expect(login.statusCode).toBe(204)
  return { url: `/api/workspaces/${workspaceId}/ledger`, headers: { ...origin, cookie: String(login.headers['set-cookie']).split(';')[0] } }
}

let owner: Awaited<ReturnType<typeof fixture>>
let outsider: Awaited<ReturnType<typeof fixture>>
const holderId = randomUUID()
const accountId = randomUUID()
const cardId = randomUUID()
const target = { targetKind: 'account', targetId: accountId }

function post(resource: string, payload: object, fixture = owner) {
  return app.inject({ method: 'POST', url: `${fixture.url}/${resource}`, headers: fixture.headers, payload })
}

function get(resource: string, fixture = owner) {
  return app.inject({ url: `${fixture.url}/${resource}`, headers: fixture.headers })
}

async function preview(csv: string) {
  const result = await post('imports/preview', { ...target, csv })
  expect(result.statusCode, result.body).toBe(200)
  return result.json()
}

beforeAll(async () => {
  await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
  owner = await fixture('Espaço do CSV')
  outsider = await fixture('Outro espaço')
  expect((await post('holders', { id: holderId, name: 'Titular sintético' })).statusCode).toBe(201)
  expect((await post('accounts', { id: accountId, holderId, name: 'Conta do teste', kind: 'bank',
    openingBalanceCents: 100000, openingDate: '2024-01-01', includeInBalance: true })).statusCode).toBe(201)
  expect((await post('cards', { id: cardId, holderId, name: 'Cartão do teste', closingDay: 25, dueDay: 8,
    limitCents: 100000 })).statusCode).toBe(201)
})
afterAll(async () => {
  await prisma.$disconnect()
  await Promise.all([app.close(), migrator.end()])
})

it('pré-visualiza sem gravar e confirma um lote simultâneo uma vez, preservando dois lançamentos iguais', async () => {
  const csv = 'data;descricao;valor;id_externo;categoria;tags\n2024-01-20;Mercado;-25,00;mov-1;Casa;mensal\n2024-01-20;Mercado;-25,00;mov-2;Casa;mensal\n2024-01-35;Inválida;18,00;;;'
  const review = await preview(csv)
  expect(review.rows).toHaveLength(3)
  expect((await get('entries?from=2024-01-01&to=2024-01-31')).json().count).toBe(0)
  const data = { ...target, csv, digest: review.digest, choices: [{ line: 2, action: 'create' }, { line: 3, action: 'create' }] }
  const responses = await Promise.all([post('imports/confirm', data), post('imports/confirm', data)])
  for (const response of responses) expect(response.statusCode, response.body).toBe(200)
  expect(responses.map((response) => response.json().repeated).sort()).toEqual([false, true])
  expect((await get('imports')).json()).toMatchObject([{ targetName: 'Conta do teste', created: 2, rejected: 1 }])
  const overlapping = await preview('data;descricao;valor;id_externo\n2024-01-20;Mercado;-25,00;mov-1')
  expect(overlapping.rows[0].duplicate).toBe(true)
  const filtered = await get('entries?from=2024-01-01&to=2024-01-31&category=casa&tag=mensal')
  expect(filtered.json()).toMatchObject({ count: 2, expenseCents: '5000' })
  const close = await get('monthly?month=2024-01-01')
  expect(close.json()).toMatchObject({ statement: { expenseCents: '5000', categories: [{ category: 'Casa', expenseCents: '5000' }] },
    cash: { netCents: '-5000' } })
  const entry = filtered.json().entries[0]
  expect((await post('classifications', { id: entry.id, category: 'Essenciais', tags: ['Revisado'] })).statusCode).toBe(200)
  expect((await get('entries?category=essenciais&tag=revisado')).json().count).toBe(1)
  expect((await post('classifications', { id: entry.id, category: '', tags: [] }, outsider)).statusCode).toBe(404)
})

it('vincula uma baixa importada a um pagamento de fatura já registrado, sem segundo débito', async () => {
  expect((await post('entries', { id: randomUUID(), kind: 'purchase', instrumentId: cardId,
    description: 'Compra para pagamento', amountCents: 6000, occurredOn: '2024-02-15' })).statusCode).toBe(201)
  const id = randomUUID()
  expect((await post('payments', { id, cardId, accountId, cycleMonth: '2024-02-01', amountCents: 2500, occurredOn: '2024-02-28' })).statusCode).toBe(201)
  const csv = 'data;descricao;valor;tipo\n2024-02-28;Débito do cartão;-25,00;pagamento_fatura'
  const review = await preview(csv)
  expect(review.rows[0].candidates).toMatchObject([{ source: 'payment', id }])
  expect((await post('imports/confirm', { ...target, csv, digest: review.digest, choices: [{ line: 2, action: 'create' }] })).statusCode).toBe(422)
  const reply = await post('imports/confirm', { ...target, csv, digest: review.digest,
    choices: [{ line: 2, action: 'link', reference: `payment:${id}` }] })
  expect(reply.statusCode, reply.body).toBe(200)
  expect(reply.json().batch).toMatchObject({ created: 0, linked: 1 })
  expect((await get('monthly?month=2024-02-01')).json()).toMatchObject({
    statement: { purchaseCents: '6000', expenseCents: '0' }, cash: { paidCents: '2500', netCents: '-2500' },
  })
})

it('refaz a conciliação na confirmação, verifica o espaço e protege o CSV exportado', async () => {
  const csv = 'data;descricao;valor\n2024-03-10;=1+1;-30,00'
  const review = await preview(csv)
  expect((await post('imports/preview', { ...target, csv }, outsider)).statusCode).toBe(422)
  expect((await get('imports', { ...outsider, url: owner.url })).statusCode).toBe(404)
  expect((await post('entries', { id: randomUUID(), kind: 'expense', instrumentId: accountId,
    description: 'Outra despesa conhecida', amountCents: 3000, occurredOn: '2024-03-10' })).statusCode).toBe(201)
  const payload = { ...target, csv, digest: review.digest, choices: [{ line: 2, action: 'create' }] }
  expect((await post('imports/confirm', payload)).statusCode).toBe(409)
  expect((await post('imports/confirm', { ...payload, choices: [{ line: 2, action: 'create', acknowledged: true }] })).statusCode).toBe(200)
  const download = await get('entries.csv?from=2024-03-01&to=2024-03-31')
  expect(download.statusCode).toBe(200)
  expect(download.headers['content-type']).toContain('text/csv')
  expect(download.body).toContain('"\'=1+1"')
})
