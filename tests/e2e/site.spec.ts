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
