import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { findWorkspace, listWorkspaces } from '../database/workspaces.ts'
import { openSession, revokeSession, sessionLifetimeSeconds, sessionUser } from './sessions.ts'

const sessionCookie = 'auto_finance_session'
const localHost = /^(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/i
const uuid = '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
const credentialsSchema = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' },
    password: { type: 'string', minLength: 15, maxLength: 128 },
  },
}

function cookieOptions(request: FastifyRequest) {
  return { path: '/api', httpOnly: true, sameSite: 'strict' as const, secure: request.protocol === 'https' }
}

export function registerAccessRoutes(app: FastifyInstance, database: Pool): void {
  app.register(async (routes) => {
    routes.addHook('onRequest', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const host = request.headers.host ?? ''
      const origin = localHost.test(host) ? URL.parse(`${request.protocol}://${host}`)?.origin : undefined
      if (!origin || (request.method === 'POST' && request.headers.origin !== origin)) {
        return reply.code(403).send({ message: 'Acesso permitido somente pela origem local da aplicação.' })
      }
    })

    routes.setErrorHandler((error, request, reply) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined
      if (status === 429) return reply.code(429).send({ message: 'Muitas tentativas. Aguarde um minuto.' })
      if (typeof status === 'number' && status >= 400 && status < 500) {
        return reply.code(status).send({ message: 'Solicitação inválida.' })
      }
      request.log.warn('Falha ao processar uma operação de acesso local.')
      return reply.code(503).send({ message: 'Serviço de acesso indisponível.' })
    })

    async function requireUser(request: FastifyRequest, reply: FastifyReply) {
      const user = await sessionUser(database, request.cookies[sessionCookie])
      if (!user) reply.code(401).send({ message: 'Entre para acessar os espaços financeiros.' })
      return user
    }

    routes.post<{ Body: { username: string; password: string } }>('/api/auth/login', {
      bodyLimit: 4096,
      schema: { body: credentialsSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const { username, password } = request.body
      const token = await openSession(database, username, password, request.cookies[sessionCookie])
      if (!token) return reply.code(401).send({ message: 'Usuário ou senha inválidos.' })

      return reply
        .setCookie(sessionCookie, token, { ...cookieOptions(request), maxAge: sessionLifetimeSeconds })
        .code(204)
        .send()
    })

    routes.post('/api/auth/logout', async (request, reply) => {
      await revokeSession(database, request.cookies[sessionCookie])
      return reply.clearCookie(sessionCookie, cookieOptions(request)).code(204).send()
    })

    routes.get('/api/auth/session', async (request, reply) => {
      const user = await requireUser(request, reply)
      if (!user) return reply
      return { user, workspaces: await listWorkspaces(database, user.id) }
    })

    routes.get<{ Params: { workspaceId: string } }>('/api/workspaces/:workspaceId', {
      schema: {
        params: {
          type: 'object',
          required: ['workspaceId'],
          properties: { workspaceId: { type: 'string', pattern: uuid } },
        },
      },
    }, async (request, reply) => {
      const user = await requireUser(request, reply)
      if (!user) return reply
      const workspace = await findWorkspace(database, user.id, request.params.workspaceId)
      if (!workspace) return reply.code(404).send({ message: 'Espaço financeiro não encontrado.' })
      return workspace
    })
  })
}
