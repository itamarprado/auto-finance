import { PrismaPg } from '@prisma/adapter-pg'
import type { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma/client.ts'

export function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}
