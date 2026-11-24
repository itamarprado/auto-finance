import pg from 'pg'
import { readPostgresUrl } from '../src/server/config.ts'
import { applyMigrations, loadMigrations, MigrationHistoryError } from '../src/server/database/migrations.ts'

let database: pg.Pool | undefined
try {
  const connectionString = readPostgresUrl(process.env, 'DATABASE_MIGRATION_URL')
  database = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 1 })
  const migrations = await loadMigrations(new URL('../database/migrations/', import.meta.url))
  const count = await applyMigrations(database, migrations)
  console.log(count === 0 ? 'Banco atualizado.' : `Migrações aplicadas: ${count}.`)
} catch (error) {
  if (error instanceof MigrationHistoryError) {
    console.error(error.message)
  } else {
    console.error('Falha na migração. Confira o bootstrap do banco e DATABASE_MIGRATION_URL.')
  }
  process.exitCode = 1
} finally {
  await database?.end()
}
