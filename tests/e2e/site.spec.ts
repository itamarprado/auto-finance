import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'

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

test('entra, abre seu espaço, mantém a sessão ao recarregar e sai', async ({ page }) => {
  const migrator = new pg.Pool({
    connectionString: readPostgresUrl(
      { DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL },
      'DATABASE_MIGRATION_URL',
    ),
  })
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const password = 'frase sintética para o navegador'
  try {
    await applyMigrations(migrator, await loadMigrations(new URL('../../database/migrations/', import.meta.url)))
    await createLocalAccount(migrator, {
      username,
      password,
      displayName: 'Pessoa do navegador',
      workspaceName: 'Espaço do navegador',
    })
  } finally {
    await migrator.end()
  }

  await page.goto('/')
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa do navegador' })).toBeVisible()

  await page.getByRole('button', { name: /Espaço do navegador/ }).click()
  await expect(page.getByText(/Espaço ativo:/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Olá, Pessoa do navegador' })).toBeVisible()

  await page.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page.getByLabel('Senha')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible()
})
