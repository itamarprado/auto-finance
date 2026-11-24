import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { inTransaction } from './transaction.ts'

interface AppliedMigration {
  version: number
  name: string
  checksum: string
}

interface Migration extends AppliedMigration {
  sql: string
}

export class MigrationHistoryError extends Error {}

export async function loadMigrations(directory: URL): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
  if (names.length === 0) {
    throw new MigrationHistoryError('Nenhuma migração SQL foi encontrada.')
  }

  return Promise.all(names.map(async (name, index) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name)
    const version = index + 1
    if (!match || Number(match[1]) !== version) {
      throw new MigrationHistoryError('Use versões de migração consecutivas a partir de 0001.')
    }
    const sql = (await readFile(new URL(name, directory), 'utf8')).replaceAll('\r\n', '\n')
    if (!sql.trim()) {
      throw new MigrationHistoryError(`A migração ${name} está vazia.`)
    }
    const checksum = createHash('sha256').update(sql).digest('hex')
    return { version, name, checksum, sql }
  }))
}

export async function applyMigrations(database: Pool, migrations: readonly Migration[]): Promise<number> {
  return inTransaction(database, async (client) => {
    await client.query("SET LOCAL search_path = pg_catalog, pg_temp")
    await client.query("SET LOCAL lock_timeout = '10s'")
    await client.query("SET LOCAL statement_timeout = '30s'")
    const { rows: [identity] } = await client.query<{ role: string }>('SELECT current_user AS role')
    if (identity.role !== 'auto_finance_migrator') {
      throw new MigrationHistoryError('Use o papel auto_finance_migrator para aplicar migrações.')
    }
    await client.query('SELECT pg_advisory_xact_lock(671263, 1)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_finance_meta.schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL UNIQUE,
        checksum text NOT NULL CHECK (length(checksum) = 64),
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await client.query('REVOKE ALL ON auto_finance_meta.schema_migrations FROM PUBLIC, auto_finance_api')

    const { rows: applied } = await client.query<AppliedMigration>(
      'SELECT version, name, checksum FROM auto_finance_meta.schema_migrations ORDER BY version',
    )
    for (const [index, entry] of applied.entries()) {
      const migration = migrations[index]
      if (!migration || entry.version !== migration.version
        || entry.name !== migration.name || entry.checksum !== migration.checksum) {
        throw new MigrationHistoryError(`Histórico de migrações divergente na versão ${entry.version}.`)
      }
    }

    const pending = migrations.slice(applied.length)
    for (const migration of pending) {
      // Este SQL vem exclusivamente dos arquivos versionados carregados pelo comando de migração.
      await client.query(migration.sql)
      await client.query(
        'INSERT INTO auto_finance_meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [migration.version, migration.name, migration.checksum],
      )
    }
    return pending.length
  })
}
