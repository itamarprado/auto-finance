import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import staticFiles from '@fastify/static'
import Fastify, { LogController } from 'fastify'
import pg from 'pg'
import { registerAccessRoutes } from './auth/routes.ts'
import type { Config } from './config.ts'
import { createPrismaClient } from './database/prisma.ts'

export function createApp(config: Config, { serveWeb = false, logger = false } = {}) {
  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }) })
  const database = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
    max: 5,
  })

  const prisma = createPrismaClient(database)
  database.on('error', () => app.log.warn('Conexão PostgreSQL inativa interrompida.'))
  app.addHook('onClose', async () => {
    try {
      await prisma.$disconnect()
    } finally {
      await database.end()
    }
  })
  app.register(cookie)
  app.register(rateLimit, { global: false, hook: 'preHandler' })
  app.register(helmet, {
    strictTransportSecurity: config.production ? undefined : false,
    xFrameOptions: { action: 'deny' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
  })

  app.get('/api/health', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      await database.query('SELECT 1')
      return { status: 'ok' }
    } catch {
      return reply.code(503).send({ status: 'unavailable' })
    }
  })

  registerAccessRoutes(app, database, prisma)

  if (serveWeb) {
    app.register(staticFiles, { root: fileURLToPath(new URL('../web/', import.meta.url)) })
  }

  return app
}
