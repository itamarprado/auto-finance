import type { Pool, PoolClient } from 'pg'
import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'

export function withFinancialLock<T>(prisma: PrismaClient, workspaceId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${workspaceId.toLowerCase()}, 634028))`
    return work(transaction)
  }, { isolationLevel: 'ReadCommitted' })
}

export async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let discard = false

  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      discard = true
    }
    throw error
  } finally {
    client.release(discard)
  }
}
