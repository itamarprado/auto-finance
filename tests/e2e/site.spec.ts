import { expect, test } from '@playwright/test'

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
