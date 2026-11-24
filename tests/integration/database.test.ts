import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPostgresUrl } from '../../src/server/config.ts'
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts'
import { createWorkspace } from '../../src/server/database/workspaces.ts'

const directory = new URL('../../database/migrations/', import.meta.url)
const migrations = await loadMigrations(directory)
const migrator = new pg.Pool({
  connectionString: readPostgresUrl({ DATABASE_MIGRATION_URL: process.env.TEST_DATABASE_MIGRATION_URL },
    'DATABASE_MIGRATION_URL'),
})
const api = new pg.Pool({
  connectionString: readPostgresUrl({ DATABASE_URL: process.env.TEST_DATABASE_URL }, 'DATABASE_URL'),
})

beforeAll(async () => {
  const metadata = await migrator.query<{ exists: boolean }>(
    "SELECT to_regclass('auto_finance_meta.schema_migrations') IS NOT NULL AS exists",
  )
  const applied = metadata.rows[0].exists
    ? (await migrator.query<{ count: number }>('SELECT count(*)::integer AS count FROM auto_finance_meta.schema_migrations')).rows[0].count
    : 0
  const counts = await Promise.all([applyMigrations(migrator, migrations), applyMigrations(migrator, migrations)])
  expect(counts.sort((left, right) => left - right)).toEqual([0, migrations.length - applied])
})

afterAll(async () => {
  await Promise.all([migrator.end(), api.end()])
})

async function insertUser() {
  const username = `fixture_${randomUUID().replaceAll('-', '')}`
  const result = await api.query<{ id: string }>(
    'INSERT INTO auto_finance.users (username, display_name) VALUES ($1, $2) RETURNING id',
    [username, 'Pessoa sintética'],
  )
  return { id: result.rows[0].id, username }
}

describe('Migrações', () => {
  it('registra uma versão uma vez e trata a reaplicação como nenhuma mudança', async () => {
    const result = await migrator.query<{ version: number; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM auto_finance_meta.schema_migrations ORDER BY version',
    )
    expect(result.rows).toEqual(migrations.map(({ version, name, checksum }) => ({ version, name, checksum })))
    await expect(applyMigrations(migrator, migrations)).resolves.toBe(0)
  })

  it('recusa uma migração aplicada com checksum divergente', async () => {
    const altered = migrations.map((migration, index) => (
      index === 0 ? { ...migration, checksum: '0'.repeat(64) } : migration
    ))
    await expect(applyMigrations(migrator, altered)).rejects.toThrow('Histórico de migrações divergente')
  })

  it('reverte o esquema e não registra uma migração que falhou', async () => {
    const version = migrations.length + 1
    const failing = {
      version,
      name: 'fixture_error.sql',
      checksum: '0'.repeat(64),
      sql: 'CREATE TABLE auto_finance.rollback_probe (id integer); SELECT nonexistent_column;',
    }
    await expect(applyMigrations(migrator, [...migrations, failing])).rejects.toMatchObject({ code: '42703' })

    const table = await migrator.query<{ present: boolean }>(
      "SELECT to_regclass('auto_finance.rollback_probe') IS NOT NULL AS present",
    )
    const recorded = await migrator.query(
      'SELECT version FROM auto_finance_meta.schema_migrations WHERE version = $1',
      [version],
    )
    expect(table.rows[0].present).toBe(false)
    expect(recorded.rowCount).toBe(0)
  })
})

describe('Integridade e papel da API', () => {
  it('cria um espaço e o vínculo de proprietário na mesma operação', async () => {
    const owner = await insertUser()
    const workspaceId = await createWorkspace(api, { name: 'Espaço sintético', ownerId: owner.id })
    const result = await api.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM auto_finance.workspace_members WHERE workspace_id = $1',
      [workspaceId],
    )
    expect(result.rows).toEqual([{ user_id: owner.id, role: 'owner' }])
  })

  it('não deixa um espaço órfão quando o proprietário não existe', async () => {
    const name = `Espaço sintético ${randomUUID()}`
    await expect(createWorkspace(api, { name, ownerId: randomUUID() })).rejects.toMatchObject({ code: '23503' })
    const result = await api.query('SELECT id FROM auto_finance.workspaces WHERE name = $1', [name])
    expect(result.rowCount).toBe(0)
  })

  it('impede identificadores duplicados e vínculos inválidos', async () => {
    const owner = await insertUser()
    const member = await insertUser()
    const workspaceId = await createWorkspace(api, { name: 'Espaço sintético', ownerId: owner.id })
    const insertMember =
      'INSERT INTO auto_finance.workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)'

    await expect(api.query(
      'INSERT INTO auto_finance.users (username, display_name) VALUES ($1, $2)',
      [owner.username, 'Pessoa sintética'],
    )).rejects.toMatchObject({ code: '23505' })
    await expect(api.query(insertMember, [workspaceId, owner.id, 'member'])).rejects.toMatchObject({ code: '23505' })
    await expect(api.query(insertMember, [workspaceId, member.id, 'invalid'])).rejects.toMatchObject({ code: '23514' })
    await expect(api.query(insertMember, [randomUUID(), member.id, 'member'])).rejects.toMatchObject({ code: '23503' })
  })

  it('permite ler dados, mas impede DDL, acesso ao ledger e migrações pela API', async () => {
    await expect(api.query('SELECT id FROM auto_finance.users LIMIT 1')).resolves.toBeDefined()
    await expect(api.query('CREATE TABLE auto_finance.forbidden_probe (id integer)'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(api.query('ALTER TABLE auto_finance.users ADD COLUMN forbidden_probe integer'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(api.query('CREATE TEMPORARY TABLE forbidden_probe (id integer)'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(api.query('SET ROLE auto_finance_migrator')).rejects.toMatchObject({ code: '42501' })
    await expect(api.query('SELECT version FROM auto_finance_meta.schema_migrations'))
      .rejects.toMatchObject({ code: '42501' })
    await expect(applyMigrations(api, migrations)).rejects.toThrow('Use o papel auto_finance_migrator')
  })
})
