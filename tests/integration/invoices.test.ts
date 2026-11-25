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
const local = { host: '127.0.0.1:3107', origin: 'http://127.0.0.1:3107' }
const password = 'Senha sintética para faturas e caixa'

async function fixture(name: string) {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const { workspaceId } = await createLocalAccount(prisma, { username, password, displayName: name, workspaceName: name })
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: local, payload: { username, password } })
  expect(res.statusCode).toBe(204)
  return { url: `/api/workspaces/${workspaceId}/ledger`, headers: { ...local, cookie: String(res.headers['set-cookie']).split(';')[0] } }
}

let owner: Awaited<ReturnType<typeof fixture>>
let outsider: Awaited<ReturnType<typeof fixture>>
const holder = randomUUID()
const cardId = randomUUID()
const accountId = randomUUID()
const destinationId = randomUUID()
const cycleMonth = '2024-01-01'

function post(resource: string, payload: object, workspace = owner) {
  return app.inject({ method: 'POST', url: `${workspace.url}/${resource}`, headers: workspace.headers, payload })
}

function get(resource: string, workspace = owner) {
  return app.inject({ url: `${workspace.url}/${resource}`, headers: workspace.headers })
}

beforeAll(async () => {
  await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
  owner = await fixture('Faturas do espaço')
  outsider = await fixture('Outro espaço')
  expect((await post('holders', { id: holder, name: 'Titular fictício' })).statusCode).toBe(201)
  for (const [id, name] of [[accountId, 'Conta corrente'], [destinationId, 'Conta de destino']]) {
    expect((await post('accounts', { id, name, holderId: holder, kind: 'bank',
      openingBalanceCents: 100000, openingDate: '2023-01-01', includeInBalance: true })).statusCode).toBe(201)
  }
  expect((await post('cards', { id: cardId, name: 'Cartão de teste', holderId: holder, limitCents: 500000,
    closingDay: 25, dueDay: 8, paymentAccountId: accountId })).statusCode).toBe(201)
})

afterAll(async () => {
  await prisma.$disconnect()
  await Promise.all([app.close(), migrator.end()])
})

it('concilia compra antiga, pagamento parcial, estornos e transferência entre contas sem somar duas vezes', async () => {
  const chargeId = randomUUID()
  expect((await post('entries', { id: chargeId, kind: 'purchase', instrumentId: cardId,
    description: 'Compra do ciclo seguinte', amountCents: 60000, occurredOn: '2023-12-29' })).statusCode).toBe(201)
  const payment = { id: randomUUID(), cardId, cycleMonth, accountId, amountCents: 25000, occurredOn: '2024-01-05' }
  const original = await post('payments', payment)
  expect(original.statusCode, original.body).toBe(201)
  expect((await post('payments', payment)).statusCode).toBe(409)
  const path = `invoices?cycleMonth=${cycleMonth}&cardId=${cardId}`
  const afterPayment = await get(path)
  expect(afterPayment.statusCode, afterPayment.body).toBe(200)
  expect(afterPayment.json()).toMatchObject({
    summaries: [{ chargeCents: '60000', paidCents: '25000', openCents: '35000', closingOn: '2024-01-25', dueOn: '2024-02-08' }],
    detail: { charges: [{ id: chargeId, source: 'purchase' }], adjustments: [{ id: payment.id, reversed: false }] },
  })
  expect((await get('invoice-cycles?from=2024-01-01&to=2024-01-01')).json()).toEqual(afterPayment.json().summaries)
  const overpayments = await Promise.all([1, 2].map(() =>
    post('payments', { ...payment, id: randomUUID(), amountCents: 30000 })))
  expect(overpayments.map((response) => response.statusCode).sort()).toEqual([201, 422])
  const extraPayment = overpayments.find((response) => response.statusCode === 201)!.json().id

  expect((await post('refunds', { id: randomUUID(), cardId, cycleMonth, chargeId, source: 'purchase',
    amountCents: 5000, occurredOn: '2024-01-12' })).statusCode).toBe(201)
  expect((await get(path)).json().summaries[0]).toMatchObject({ refundCents: '5000', openCents: '0' })
  expect((await post('refunds', { id: randomUUID(), cardId, cycleMonth, chargeId, source: 'purchase',
    amountCents: 55001, occurredOn: '2024-01-12' })).statusCode).toBe(422)
  const reversal = { id: randomUUID(), paymentId: extraPayment, occurredOn: '2024-01-15' }
  expect((await post('payment-reversals', reversal)).statusCode).toBe(201)
  expect((await post('payment-reversals', { ...reversal, id: randomUUID() })).statusCode).toBe(409)
  expect((await get(path)).json().summaries[0]).toMatchObject({ paidCents: '25000', openCents: '30000' })

  expect((await post('transfers', { id: randomUUID(), description: 'Mover saldo', accountId, destinationId,
    amountCents: 20000, occurredOn: '2024-01-17' })).statusCode).toBe(201)
  const cashPath = 'cash?from=2024-01-01&to=2024-01-31'
  const cash = await get(cashPath)
  expect(cash.statusCode, cash.body).toBe(200)
  expect(cash.json()).toMatchObject({ count: 5, paidCents: '25000', incomeCents: '0', expenseCents: '0',
    transferNetCents: '0', netCents: '-25000' })
  expect((await get(`${cashPath}&accountId=${destinationId}`)).json())
    .toMatchObject({ count: 1, transferNetCents: '20000', netCents: '20000' })
  expect((await get('catalog')).json().accounts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: accountId, balanceCents: '55000' }),
    expect.objectContaining({ id: destinationId, balanceCents: '120000' }),
  ]))
  expect((await get('entries?from=2024-01-01&to=2024-01-31')).json())
    .toMatchObject({ count: 1, refundCents: '5000', expenseCents: '0' })
})

it('recompõe centavos em três ciclos e limita o acesso ao cartão do próprio espaço', async () => {
  const id = randomUUID()
  const installment = { id, cardId, description: "Compra d'Ávila", amountCents: 10000, occurredOn: '2024-02-25', installmentCount: 3 }
  expect((await post('installments', installment)).statusCode).toBe(201)
  expect((await post('installments', installment)).statusCode).toBe(409)
  for (const [number, month, amount] of [[1, '02', '3333'], [2, '03', '3333'], [3, '04', '3334']]) {
    const invoice = await get(`invoices?cycleMonth=2024-${month}-01&cardId=${cardId}`)
    expect(invoice.statusCode, invoice.body).toBe(200)
    expect(invoice.json().detail.charges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, installmentNumber: number, installmentCount: 3, amountCents: amount }),
    ]))
  }
  expect((await get('entries?from=2024-02-01&to=2024-02-29')).json())
    .toMatchObject({ count: 1, purchaseCents: '10000' })
  expect((await get('cash?from=2024-02-01&to=2024-04-30')).json()).toMatchObject({ count: 0, netCents: '0' })
  expect((await get(`invoices?cycleMonth=2024-02-01&cardId=${cardId}`, outsider)).statusCode).toBe(404)
  expect((await post('installments', { ...installment, id: randomUUID() }, outsider)).statusCode).toBe(422)
  expect((await post('installments', { ...installment, id: randomUUID(), firstCycle: '2024-01-01' })).statusCode).toBe(422)
})

it('ajusta o fechamento no mês curto e mostra crédito quando um estorno chega depois da quitação', async () => {
  const shortMonthCard = randomUUID()
  const chargeId = randomUUID()
  const cycleMonth = '2024-02-01'
  const path = `invoices?cycleMonth=${cycleMonth}&cardId=${shortMonthCard}`
  expect((await post('cards', { id: shortMonthCard, name: 'Cartão de fechamento no dia 31', holderId: holder,
    limitCents: 10000, closingDay: 31, dueDay: 30 })).statusCode).toBe(201)
  expect((await post('entries', { id: chargeId, kind: 'purchase', instrumentId: shortMonthCard,
    amountCents: 5000, description: 'Compra no último dia do mês', occurredOn: '2024-02-29' })).statusCode).toBe(201)
  expect((await get(path)).json().summaries).toEqual(expect.arrayContaining([
    expect.objectContaining({ cardId: shortMonthCard, closingOn: '2024-02-29', dueOn: '2024-03-30', openCents: '5000' }),
  ]))
  expect((await post('payments', { id: randomUUID(), cardId: shortMonthCard, accountId, cycleMonth,
    amountCents: 5000, occurredOn: '2024-03-01' })).statusCode).toBe(201)
  expect((await post('refunds', { id: randomUUID(), cardId: shortMonthCard, cycleMonth, chargeId, source: 'purchase',
    amountCents: 700, occurredOn: '2024-03-02' })).statusCode).toBe(201)
  expect((await get(path)).json().summaries).toEqual(expect.arrayContaining([
    expect.objectContaining({ cardId: shortMonthCard, openCents: '0', creditCents: '700' }),
  ]))
  const history = 'invoice-cycles?from=2024-02-01&to=2024-04-01'
  const listed = await get(history)
  expect(listed.statusCode).toBe(200)
  expect(listed.json()).toHaveLength(4)
  expect(listed.json().filter((cycle: { cardId: string }) => cycle.cardId === cardId)).toMatchObject([
    { cycleMonth: '2024-04-01' }, { cycleMonth: '2024-03-01' }, { cycleMonth: '2024-02-01' },
  ])
  expect(listed.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ cardId: shortMonthCard, cycleMonth: '2024-02-01', creditCents: '700' }),
  ]))
  expect((await get(history, outsider)).json()).toEqual([])
  expect((await get(history, { url: owner.url, headers: outsider.headers })).statusCode).toBe(404)
  expect((await get('invoice-cycles?from=2020-01-01&to=2025-01-01')).statusCode).toBe(422)
  expect((await get('cash?from=2024-03-01&to=2024-03-31')).json())
    .toMatchObject({ count: 1, paidCents: '5000', netCents: '-5000' })
})
