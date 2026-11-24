import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { readConfig } from '../../src/server/config.ts'

let app: ReturnType<typeof createApp> | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /api/health', () => {
  it('retorna sucesso depois de consultar um PostgreSQL real', async () => {
    app = createApp(readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL }))

    const response = await app.inject({ url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('responde 503 com uma mensagem genérica quando o banco está indisponível', async () => {
    app = createApp(readConfig({ DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/auto_finance' }))

    const response = await app.inject({ url: '/api/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'unavailable' })
  })
})
