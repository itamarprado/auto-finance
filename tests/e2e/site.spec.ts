import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import pg from 'pg'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'
import { createPrismaClient } from '../../src/server/database/prisma.ts'

test('o build web abre e confirma a conexão real com o PostgreSQL', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Auto Finance' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Banco de dados conectado.')
})

test('a página inicial envia os cabeçalhos de segurança do build', async ({ page }) => {
  const response = await page.goto('/')
  const headers = response?.headers()

  expect(response?.status()).toBe(200)
  expect(headers?.['x-content-type-options']).toBe('nosniff')
  expect(headers?.['x-frame-options']).toBe('DENY')
  const policy = headers?.['content-security-policy'] ?? ''
  expect(policy).toContain("default-src 'self'")
  expect(policy).toContain("frame-ancestors 'none'")
  expect(policy).not.toContain("'unsafe-inline'")
})

test('a página indica indisponibilidade quando a API retorna 503', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    status: 503,
    json: { status: 'unavailable' },
  }))
  await page.goto('/')

  await expect(page.getByRole('status')).toHaveText('Banco de dados indisponível.')
})

async function enterBrowserWorkspace(page: Page, workspaceName: string) {
  const migrator = new pg.Pool({
    connectionString: readPostgresUrl(
      { DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL },
      'DATABASE_MIGRATION_URL',
    ),
  })
  const provisioning = createPrismaClient(migrator)
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const password = 'frase sintética para o navegador'
  try {
    await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
    await createLocalAccount(provisioning, {
      username,
      password,
      displayName: 'Pessoa do navegador',
      workspaceName,
    })
  } finally {
    await provisioning.$disconnect()
    await migrator.end()
  }

  await page.goto('/')
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa do navegador' })).toBeVisible()

  await page.getByRole('button', { name: new RegExp(workspaceName) }).click()
  await expect(page.getByText(/Espaço ativo:/)).toBeVisible()
}

test('entra, abre seu espaço, mantém a sessão ao recarregar e sai', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço do navegador')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa do navegador' })).toBeVisible()

  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page.getByLabel('Senha')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
})

test('cadastra titular, conta e cartão pela interface e filtra movimentações persistidas', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço financeiro do navegador')
  const nav = page.getByRole('navigation', { name: 'Área financeira' })
  const dialog = page.getByRole('dialog')
  const save = async () => {
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  await page.getByRole('button', { name: 'Novo lançamento' }).click()
  await expect(page.getByRole('heading', { name: 'Titulares', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Novo titular' }).click()
  await dialog.getByLabel('Nome', { exact: true }).fill('Pessoa de teste')
  await save()
  await expect(page.getByText('Pessoa de teste', { exact: true })).toBeVisible()

  await nav.getByRole('button', { name: 'Contas', exact: true }).click()
  await page.getByRole('button', { name: 'Nova conta' }).click()
  await dialog.getByLabel('Nome', { exact: true }).fill('Conta de teste')
  await dialog.getByRole('combobox', { name: 'Titular', exact: true }).selectOption({ label: 'Pessoa de teste' })
  await dialog.getByLabel('Saldo inicial em reais').fill('250,00')
  await save()
  await expect(page.getByText('Conta de teste', { exact: true })).toBeVisible()

  await nav.getByRole('button', { name: 'Cartões', exact: true }).click()
  await page.getByRole('button', { name: 'Novo cartão' }).click()
  await dialog.getByLabel('Nome', { exact: true }).fill('Cartão de teste')
  await dialog.getByRole('combobox', { name: 'Titular', exact: true }).selectOption({ label: 'Pessoa de teste' })
  await dialog.getByRole('combobox', { name: 'Conta pagadora', exact: true }).selectOption({ label: 'Conta de teste' })
  await dialog.getByLabel('Final do cartão (opcional)').fill('0024')
  await dialog.getByLabel('Limite em reais').fill('890,00')
  await dialog.getByLabel('Dia de fechamento').fill('23')
  await dialog.getByLabel('Dia de vencimento').fill('6')
  await save()
  await expect(page.getByText('Cartão de teste · •••• 0024', { exact: true })).toBeVisible()

  await nav.getByRole('button', { name: 'Extrato', exact: true }).click()
  for (const [kind, description, sourceLabel, source, amount] of [
    ['income', 'Recebimento sintético', 'Conta', 'Conta de teste', '500,00'],
    ['expense', 'Despesa sintética', 'Conta', 'Conta de teste', '59,90'],
    ['purchase', 'Compra sintética', 'Cartão', 'Cartão de teste', '20,50'],
  ]) {
    await page.getByRole('button', { name: 'Novo lançamento' }).click()
    await dialog.getByRole('combobox', { name: 'Tipo de lançamento', exact: true }).selectOption(kind)
    await dialog.getByLabel('Descrição').fill(description)
    await dialog.getByRole('combobox', { name: sourceLabel, exact: true }).selectOption({ label: source })
    await dialog.getByLabel('Valor em reais').fill(amount)
    await save()
    await expect(page.getByRole('row', { name: new RegExp(description) })).toBeVisible()
  }
  await expect(page.getByRole('region', { name: 'Resumo financeiro' })).toContainText('R$ 690,10')
  await page.reload()
  await page.getByRole('button', { name: /Espaço financeiro do navegador/ }).click()
  await page.getByRole('combobox', { name: 'Origem', exact: true }).selectOption({ label: 'Cartão de teste' })
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  await expect(page.getByRole('row', { name: /Compra sintética/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /Recebimento sintético|Despesa sintética/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Resumo financeiro' })).toContainText('R$ 20,50')
  await expect(page.getByRole('region', { name: 'Resumo financeiro' })).toContainText('R$ 690,10')

  await page.setViewportSize({ width: 360, height: 780 })
  const amount = page.getByRole('row', { name: /Compra sintética/ }).getByRole('cell', { name: /20,50/ })
  await expect(amount).toBeVisible()
  const amountBox = await amount.boundingBox()
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(360)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('mantém filtros e navegação dentro do painel em desktop com fonte ampliada e em tela estreita', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço para conferir o layout')
  const filter = page.getByRole('button', { name: 'Filtrar', exact: true })
  const region = page.getByRole('region', { name: 'Extrato por período' })
  await expect(filter).toBeVisible()

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1152, height: 720 }, { width: 360, height: 780 }]) {
    await page.setViewportSize(viewport)
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px' })
    const panel = (await region.boundingBox())!
    const button = (await filter.boundingBox())!
    expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})

test('registra parcela, pagamento parcial, estorno e transferência entre as telas de faturas e caixa', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço de faturas do navegador')
  const origin = new URL(page.url()).origin
  const session = await (await page.request.get('/api/auth/session')).json()
  const ledger = `/api/workspaces/${session.workspaces[0].id}/ledger`
  const holderId = randomUUID()
  const accountId = randomUUID()
  const destinationId = randomUUID()
  async function seed(resource: string, data: object) {
    const res = await page.request.post(`${ledger}/${resource}`, { headers: { Origin: origin }, data })
    expect(res.status()).toBe(201)
  }
  await seed('holders', { id: holderId, name: 'Titular de faturas' })
  for (const [id, name] of [[accountId, 'Conta pagadora de teste'], [destinationId, 'Reserva de teste']]) {
    await seed('accounts', { id, name, holderId, kind: 'bank', openingDate: '2024-01-01',
      openingBalanceCents: 10000, includeInBalance: true })
  }
  await seed('cards', { id: randomUUID(), name: 'Cartão de faturas', holderId, limitCents: 100000, closingDay: 25, dueDay: 8,
    paymentAccountId: accountId })
  const otherCardId = randomUUID()
  await seed('cards', { id: otherCardId, name: 'Outro cartão', holderId, limitCents: 100000, closingDay: 25, dueDay: 8 })
  await seed('entries', { id: randomUUID(), kind: 'purchase', instrumentId: otherCardId,
    description: 'Compra exclusiva do outro cartão', amountCents: 5900, occurredOn: '2024-02-12' })
  await page.reload()
  await page.getByRole('button', { name: /Espaço de faturas do navegador/ }).click()
  const nav = page.getByRole('navigation', { name: 'Área financeira' })
  const dialog = page.getByRole('dialog')
  async function submit(amount: string, date: string) {
    await dialog.getByLabel('Valor em reais', { exact: true }).fill(amount)
    await dialog.getByLabel('Data da movimentação', { exact: true }).fill(date)
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  await nav.getByRole('button', { name: 'Faturas', exact: true }).click()
  await page.getByLabel('Do mês', { exact: true }).fill('2024-02')
  await page.getByLabel('Até o mês', { exact: true }).fill('2024-03')
  const fromMonth = (await page.getByLabel('Do mês', { exact: true }).boundingBox())!
  const toMonth = (await page.getByLabel('Até o mês', { exact: true }).boundingBox())!
  expect(fromMonth.x + fromMonth.width).toBeLessThanOrEqual(toMonth.x)
  await page.getByRole('button', { name: 'Filtrar faturas', exact: true }).click()
  await page.getByRole('button', { name: 'Nova compra parcelada', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Cartão', exact: true }).selectOption({ label: 'Cartão de faturas' })
  await dialog.getByLabel('Descrição', { exact: true }).fill('Compra em três parcelas')
  await dialog.getByLabel('Número de parcelas', { exact: true }).fill('3')
  await submit('100,00', '2024-02-20')
  const card = page.getByRole('region', { name: 'Cartão de faturas', exact: true })
  const otherCard = page.getByRole('region', { name: 'Outro cartão', exact: true })
  await expect(card.getByRole('button', { name: /Cartão de faturas/ })).toContainText('2 faturas')
  await expect(otherCard.getByRole('button', { name: /Outro cartão/ })).toContainText('1 fatura')
  const group = card.getByRole('button', { name: /Cartão de faturas/ })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  await card.getByRole('button', { name: /fevereiro de 2024/i }).click()
  const details = page.getByRole('region', { name: 'Detalhes da fatura' })
  await expect(details).toContainText('Parcela 1/3')
  await expect(details).not.toContainText('Compra exclusiva do outro cartão')
  await expect(details).not.toContainText('Parcela 2/3')
  await expect(card).toHaveCount(0)
  await expect(page).toHaveURL(/cycle=2024-02/)
  await page.reload()
  await expect(details).toContainText('Parcela 1/3')
  await expect(details).toContainText('R$ 33,33')
  await page.getByRole('button', { name: 'Registrar pagamento', exact: true }).click()
  await submit('15,00', '2024-02-26')
  await expect(details).toContainText('Pagamento de fatura')
  await expect(details).toContainText('R$ 18,33')
  await page.getByRole('button', { name: 'Estornar compra Compra em três parcelas', exact: true }).click()
  await submit('5,00', '2024-02-27')
  await expect(details).toContainText('R$ 13,33')
  await page.goBack()
  await expect(page.getByLabel('Do mês', { exact: true })).toHaveValue('2024-02')
  await expect(group).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByRole('button', { name: /fevereiro de 2024/i })).toContainText('R$ 13,33')
  await card.getByRole('button', { name: /fevereiro de 2024/i }).click()
  await page.setViewportSize({ width: 360, height: 780 })
  await expect(details).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Voltar para faturas', exact: true }).click()
  await expect(card.getByRole('button', { name: /fevereiro de 2024/i })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })

  await nav.getByRole('button', { name: 'Fluxo de caixa', exact: true }).click()
  const cash = page.getByRole('region', { name: 'Movimentações de caixa' })
  await page.getByLabel('De', { exact: true }).fill('2024-02-01')
  await page.getByLabel('Até', { exact: true }).fill('2024-02-29')
  await page.getByRole('button', { name: 'Filtrar caixa', exact: true }).click()
  await expect(cash).toContainText('Pagamento de fatura')
  await expect(cash).not.toContainText('Compra em três parcelas')
  await page.getByRole('button', { name: 'Nova transferência', exact: true }).click()
  await dialog.getByLabel('Descrição', { exact: true }).fill('Transferência de teste')
  await dialog.getByRole('combobox', { name: 'Conta de origem', exact: true }).selectOption(accountId)
  await dialog.getByRole('combobox', { name: 'Conta de destino', exact: true }).selectOption(destinationId)
  await submit('20,00', '2024-02-28')
  await expect(cash.getByText('Transferência de teste', { exact: true })).toHaveCount(2)
  await expect(cash).toContainText('-R$ 15,00')

  await page.setViewportSize({ width: 360, height: 780 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('confirma um CSV, identifica a reaplicação e confere a classificação no fechamento mensal', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço de importação do navegador')
  const origin = new URL(page.url()).origin
  const session = await (await page.request.get('/api/auth/session')).json()
  const ledger = `/api/workspaces/${session.workspaces[0].id}/ledger`
  const holderId = randomUUID()
  const accountId = randomUUID()
  const headers = { Origin: origin }
  expect((await page.request.post(`${ledger}/holders`, { headers, data: { id: holderId, name: 'Titular do CSV' } })).status()).toBe(201)
  expect((await page.request.post(`${ledger}/accounts`, { headers, data: { id: accountId, holderId,
    name: 'Conta do extrato CSV', kind: 'bank', openingBalanceCents: 10000, openingDate: '2024-01-01', includeInBalance: true } })).status()).toBe(201)
  await page.reload()
  await page.getByRole('button', { name: /Espaço de importação do navegador/ }).click()
  const nav = page.getByRole('navigation', { name: 'Área financeira' })
  await nav.getByRole('button', { name: 'Importar CSV', exact: true }).click()
  await page.getByRole('combobox', { name: 'Destino', exact: true }).selectOption(accountId)
  const fixture = { name: 'transacoes-sinteticas.csv', mimeType: 'text/csv',
    buffer: Buffer.from('data;descricao;valor;categoria;tags\n2024-04-02;Mercado do arquivo;-32,50;Casa;compras') }
  await page.getByLabel('Arquivo CSV').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Gerar prévia' }).click()
  const preview = page.getByRole('region', { name: 'Prévia da importação' })
  await expect(preview).toContainText('Mercado do arquivo')
  await page.getByRole('button', { name: 'Confirmar importação' }).click()
  await expect(page.getByRole('region', { name: 'Histórico de lotes' })).toContainText('1 novo ·')
  await page.getByLabel('Arquivo CSV').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Gerar prévia' }).click()
  await expect(preview).toContainText('Este arquivo já foi importado')

  await nav.getByRole('button', { name: 'Extrato', exact: true }).click()
  await page.getByLabel('De', { exact: true }).fill('2024-04-01')
  await page.getByLabel('Até', { exact: true }).fill('2024-04-30')
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click()
  await page.getByRole('button', { name: 'Classificar Mercado do arquivo', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Classificar lançamento' })
  await dialog.getByLabel('Categoria', { exact: true }).fill('Essenciais')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('row', { name: /Mercado do arquivo/ })).toContainText('Essenciais')

  await nav.getByRole('button', { name: 'Fechamento mensal', exact: true }).click()
  await page.getByLabel('Mês de referência').fill('2024-04')
  const report = page.getByRole('region', { name: 'Fechamento mensal' })
  await expect(report).toContainText('Essenciais')
  await expect(report).toContainText('R$ 32,50')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Exportar extrato do mês' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('extrato-auto-finance.csv')
  await page.setViewportSize({ width: 360, height: 780 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('divide uma compra, concilia o PIX e mantém o rateio acessível em tela estreita', async ({ page }) => {
  await enterBrowserWorkspace(page, 'Espaço dos rateios no navegador')
  const session = await (await page.request.get('/api/auth/session')).json()
  const ledger = `/api/workspaces/${session.workspaces[0].id}/ledger`
  const headers = { Origin: new URL(page.url()).origin }
  const payer = randomUUID()
  const participant = randomUUID()
  const account = randomUUID()
  const card = randomUUID()
  const purchase = randomUUID()
  const payment = randomUUID()
  const seed = async (path: string, data: object) => {
    const response = await page.request.post(`${ledger}/${path}`, { headers, data })
    expect(response.status()).toBe(201)
  }
  await seed('holders', { id: payer, name: 'Pessoa A' })
  await seed('holders', { id: participant, name: 'Pessoa B' })
  await seed('accounts', { id: account, holderId: payer, name: 'Conta da Pessoa A', kind: 'bank',
    openingBalanceCents: 0, openingDate: '2024-01-01', includeInBalance: true })
  await seed('cards', { id: card, holderId: payer, name: 'Cartão da Pessoa A', closingDay: 25, dueDay: 8, limitCents: 100000 })
  await seed('entries', { id: purchase, kind: 'purchase', instrumentId: card, description: 'Mercado compartilhado',
    amountCents: 24000, occurredOn: '2024-06-10' })
  await seed('entries', { id: payment, kind: 'income', instrumentId: account, description: 'PIX de acerto',
    amountCents: 12000, occurredOn: '2024-06-11' })

  await page.reload()
  await page.getByRole('button', { name: /Espaço dos rateios no navegador/ }).click()
  await page.getByRole('navigation', { name: 'Área financeira' }).getByRole('button', { name: 'Rateios e acertos' }).click()
  await page.getByRole('button', { name: 'Novo rateio', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Novo rateio' })
  await add.getByLabel('Despesa original').selectOption(`entry:${purchase}`)
  await expect(add.getByLabel('Quem pagou')).toHaveValue(payer)
  await add.getByRole('checkbox', { name: 'Pessoa A', exact: true }).check()
  await add.getByRole('checkbox', { name: 'Pessoa B', exact: true }).check()
  await add.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(add).toBeHidden()
  const splits = page.getByRole('region', { name: 'Rateios registrados' })
  await expect(splits).toContainText('Falta pagar R$ 120,00')

  await page.setViewportSize({ width: 360, height: 780 })
  await splits.getByRole('button', { name: 'Conciliar reembolso de Pessoa B em Mercado compartilhado' }).click()
  const settle = page.getByRole('dialog', { name: 'Conciliar reembolso' })
  await settle.getByLabel('Movimentação do reembolso').selectOption(`entry:${payment}`)
  await settle.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(settle).toBeHidden()
  await expect(splits).toContainText('Quitado')
  await expect(splits).toContainText('PIX de acerto')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
