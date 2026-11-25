import { createHash, randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/server/app.ts'
import { createLocalAccount } from '../../src/server/auth/accounts.ts'
import { readConfig, readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'
import { createPrismaClient } from '../../src/server/database/prisma.ts'

const config = readConfig({ DATABASE_URL: process.env.TEST_DATABASE_URL })
const migrator = new pg.Pool({
  connectionString: readPostgresUrl(
    { DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL },
    'DATABASE_MIGRATION_URL',
  ),
})
const provisioning = createPrismaClient(migrator)
const local = { host: '127.0.0.1:3107', origin: 'http://127.0.0.1:3107' }
const fixturePassword = 'frase sintética de autenticação'
const firstUsername = `fixture_${randomUUID().replaceAll('-', '')}`
const secondUsername = `fixture_${randomUUID().replaceAll('-', '')}`

let app: ReturnType<typeof createApp> | undefined
let first: Awaited<ReturnType<typeof createLocalAccount>>
let second: Awaited<ReturnType<typeof createLocalAccount>>

beforeAll(async () => {
  const migrations = await loadMigrations(new URL('../../database/migrations/', import.meta.url))
  await applyMigrations(migrator, migrations)
  const [owner, other] = await Promise.all([
    createLocalAccount(provisioning, {
      username: firstUsername, displayName: 'Pessoa de teste', workspaceName: 'Espaço de teste', password: fixturePassword,
    }),
    createLocalAccount(provisioning, {
      username: secondUsername, displayName: 'Outra pessoa', workspaceName: 'Outro espaço', password: fixturePassword,
    }),
  ])
  first = owner
  second = other
})

afterEach(async () => {
  await app?.close()
  app = undefined
})
afterAll(async () => {
  await provisioning.$disconnect()
  await migrator.end()
})

function login(server: ReturnType<typeof createApp>, username = firstUsername, password = fixturePassword) {
  return server.inject({ method: 'POST', url: '/api/auth/login', headers: local, payload: { username, password } })
}

function cookieHeader(response: Awaited<ReturnType<typeof login>>): string {
  const cookie = response.headers['set-cookie']
  expect(typeof cookie).toBe('string')
  return (cookie as string).split(';')[0]
}

describe('acesso local', () => {
  it('reverte a criação da conta se o espaço inicial não for válido', async () => {
    const username = `fixture_${randomUUID().replaceAll('-', '')}`
    await expect(createLocalAccount(provisioning, {
      username, displayName: 'Pessoa de teste', workspaceName: '', password: fixturePassword,
    })).rejects.toMatchObject({ meta: { driverAdapterError: { cause: { originalCode: '23514' } } } })
    const result = await migrator.query('SELECT id FROM auto_finance.users WHERE username = $1', [username])
    expect(result.rowCount).toBe(0)
  })

  it('nega o acesso anônimo e aceita somente origem local em operações de sessão', async () => {
    app = createApp(config)
    const anonymous = await app.inject({ url: `/api/workspaces/${first.workspaceId}`, headers: local })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.headers['cache-control']).toBe('no-store')
    const noOrigin = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { host: local.host },
      payload: { username: firstUsername, password: fixturePassword },
    })
    expect(noOrigin.statusCode).toBe(403)
    const otherOrigin = await app.inject({
      method: 'POST', url: '/api/auth/logout', headers: { ...local, origin: 'http://127.0.0.1:3108' },
    })
    expect(otherOrigin.statusCode).toBe(403)
    const nonLocal = await app.inject({ url: '/api/auth/session', headers: { host: 'example.invalid' } })
    expect(nonLocal.statusCode).toBe(403)
  })

  it('cria uma sessão opaca com hash persistido e cookie restrito', async () => {
    app = createApp(config)
    const result = await login(app)
    expect(result.statusCode).toBe(204)
    expect(result.body).toBe('')
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['set-cookie']).toEqual(expect.stringContaining('HttpOnly'))
    expect(result.headers['set-cookie']).toEqual(expect.stringContaining('SameSite=Strict'))
    expect(result.headers['set-cookie']).toEqual(expect.stringContaining('Path=/api'))
    const token = cookieHeader(result).split('=')[1]
    const digest = createHash('sha256').update(token).digest()
    const stored = await migrator.query(
      'SELECT user_id FROM auto_finance.auth_sessions WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP',
      [digest],
    )
    expect(stored.rows).toEqual([{ user_id: first.userId }])
  })

  it('devolve a mesma mensagem para usuário ausente ou senha incorreta', async () => {
    app = createApp(config)
    const unknown = await login(app, 'fixture_ausente')
    const wrong = await login(app, firstUsername, 'outra frase sintética de teste')
    expect(unknown.statusCode).toBe(401)
    expect(wrong.statusCode).toBe(401)
    expect(unknown.json()).toEqual(wrong.json())
    expect(wrong.headers['set-cookie']).toBeUndefined()
  })

  it('lista só os espaços autorizados e recusa a leitura do espaço de outra conta', async () => {
    app = createApp(config)
    const cookie = cookieHeader(await login(app))
    const headers = { ...local, cookie }
    const identity = await app.inject({ url: '/api/auth/session', headers })
    expect(identity.statusCode).toBe(200)
    expect(identity.json()).toEqual({
      user: { id: first.userId, username: firstUsername, displayName: 'Pessoa de teste' },
      workspaces: [{ id: first.workspaceId, name: 'Espaço de teste', role: 'owner' }],
    })
    const own = await app.inject({ url: `/api/workspaces/${first.workspaceId}`, headers })
    expect(own.statusCode).toBe(200)
    const other = await app.inject({ url: `/api/workspaces/${second.workspaceId}`, headers })
    expect(other.statusCode).toBe(404)

    await migrator.query(
      "INSERT INTO auto_finance.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')",
      [second.workspaceId, first.userId],
    )
    try {
      const shared = await app.inject({ url: `/api/workspaces/${second.workspaceId}`, headers })
      expect(shared.statusCode).toBe(200)
      expect(shared.json()).toMatchObject({ id: second.workspaceId, role: 'member' })
    } finally {
      await migrator.query(
        'DELETE FROM auto_finance.workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [second.workspaceId, first.userId],
      )
    }
    const removed = await app.inject({ url: `/api/workspaces/${second.workspaceId}`, headers })
    expect(removed.statusCode).toBe(404)
  })

  it('revoga o token anterior ao entrar novamente e a sessão atual ao sair', async () => {
    app = createApp(config)
    const previous = cookieHeader(await login(app))
    const next = await app.inject({
      method: 'POST', url: '/api/auth/login', headers: { ...local, cookie: previous },
      payload: { username: firstUsername, password: fixturePassword },
    })
    expect(next.statusCode).toBe(204)
    const current = cookieHeader(next)
    expect(current).not.toBe(previous)
    const oldSession = await app.inject({ url: '/api/auth/session', headers: { ...local, cookie: previous } })
    expect(oldSession.statusCode).toBe(401)
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...local, cookie: current } })
    expect(logout.statusCode).toBe(204)
    expect(logout.headers['set-cookie']).toEqual(expect.stringContaining('Max-Age=0'))
    const revoked = await app.inject({ url: '/api/auth/session', headers: { ...local, cookie: current } })
    expect(revoked.statusCode).toBe(401)
  })

  it('recusa uma sessão vencida', async () => {
    app = createApp(config)
    const cookie = cookieHeader(await login(app))
    const digest = createHash('sha256').update(cookie.split('=')[1]).digest()
    await migrator.query(
      `UPDATE auto_finance.auth_sessions
       SET created_at = CURRENT_TIMESTAMP - interval '2 days',
           expires_at = CURRENT_TIMESTAMP - interval '1 day'
       WHERE token_hash = $1`,
      [digest],
    )
    const expired = await app.inject({ url: '/api/auth/session', headers: { ...local, cookie } })
    expect(expired.statusCode).toBe(401)
  })

  it('reconhece e revoga uma sessão gravada antes da adoção do Prisma', async () => {
    const token = randomBytes(32).toString('base64url')
    const digest = createHash('sha256').update(token).digest()
    await migrator.query(
      `INSERT INTO auto_finance.auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + interval '1 hour')`,
      [digest, first.userId],
    )
    app = createApp(config)
    const headers = { ...local, cookie: `auto_finance_session=${token}` }
    const active = await app.inject({ url: '/api/auth/session', headers })
    expect(active.statusCode).toBe(200)
    expect(active.json()).toMatchObject({ user: { id: first.userId } })
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers })
    expect(logout.statusCode).toBe(204)
    expect((await app.inject({ url: '/api/auth/session', headers })).statusCode).toBe(401)
  })

  it('limita as tentativas de login por origem de rede', async () => {
    app = createApp(config)
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await login(app, 'fixture_ausente')).statusCode).toBe(401)
    }
    const limited = await login(app, 'fixture_ausente')
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
  }, 15_000)
})
