import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { sessionUser } from '../auth/sessions.ts'
import { addAccount, addCard, addEntry, addHolder, getCatalog, getStatement } from '../database/ledger.ts'
import type { AccountInput, CardInput, EntryFilter, EntryInput, HolderInput } from '../database/ledger.ts'
import { findWorkspace } from '../database/workspaces.ts'

interface WorkspaceParams {
  workspaceId: string
}

type RequireUser = (request: FastifyRequest, reply: FastifyReply) => ReturnType<typeof sessionUser>

const uuid = { type: 'string', pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
const name = { type: 'string', minLength: 1, maxLength: 120 }
const money = { type: 'integer', maximum: Number.MAX_SAFE_INTEGER }
const day = { type: 'integer', minimum: 1, maximum: 31 }
const entryKind = { type: 'string', enum: ['income', 'expense', 'purchase'] }

export const workspaceParamsSchema = {
  type: 'object',
  required: ['workspaceId'],
  properties: { workspaceId: uuid },
}

function bodySchema(properties: Record<string, object>, required: string[]) {
  return {
    bodyLimit: 4096,
    schema: {
      params: workspaceParamsSchema,
      body: { type: 'object', required, properties, additionalProperties: false },
    },
  }
}

function validDate(value: string): boolean {
  if (value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function invalidDate(reply: FastifyReply) {
  return reply.code(422).send({ message: 'Confira as datas informadas.' })
}

async function save(reply: FastifyReply, id: string, write: () => Promise<boolean>) {
  try {
    if (await write()) return reply.code(201).send({ id })
    return reply.code(409).send({ message: 'O registro já foi recebido. Confira a lista antes de enviar novamente.' })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (code === '23503') return reply.code(422).send({ message: 'Selecione um vínculo deste espaço financeiro.' })
    if (code === '23514') return reply.code(422).send({ message: 'Confira os campos do registro.' })
    throw error
  }
}

export function registerLedgerRoutes(routes: FastifyInstance, database: Pool, requireUser: RequireUser): void {
  routes.register(async (ledger) => {
    ledger.addHook('preHandler', async (request, reply) => {
      const user = await requireUser(request, reply)
      if (!user) return reply
      const { workspaceId } = request.params as WorkspaceParams
      if (!await findWorkspace(database, user.id, workspaceId)) {
        return reply.code(404).send({ message: 'Espaço financeiro não encontrado.' })
      }
    })

    ledger.get<{ Params: WorkspaceParams }>('/ledger/catalog', {
      schema: { params: workspaceParamsSchema },
    }, (request) => getCatalog(database, request.params.workspaceId))

    ledger.get<{ Params: WorkspaceParams; Querystring: EntryFilter }>('/ledger/entries', {
      schema: {
        params: workspaceParamsSchema,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: date, to: date, accountId: uuid, cardId: uuid, kind: entryKind,
            search: { type: 'string', maxLength: 160 },
            page: { type: 'integer', minimum: 1, maximum: 1_000_000 },
          },
        },
      },
    }, async (request, reply) => {
      const filter = request.query
      if ((filter.from && !validDate(filter.from)) || (filter.to && !validDate(filter.to))
        || (filter.from && filter.to && filter.from > filter.to)) return invalidDate(reply)
      return getStatement(database, request.params.workspaceId, filter)
    })

    ledger.post<{ Params: WorkspaceParams; Body: HolderInput }>('/ledger/holders',
      bodySchema({ id: uuid, name }, ['id', 'name']),
      (request, reply) => save(reply, request.body.id, () => addHolder(database, request.params.workspaceId, request.body)))

    ledger.post<{ Params: WorkspaceParams; Body: AccountInput }>('/ledger/accounts',
      bodySchema({
        id: uuid, holderId: uuid, name, kind: { type: 'string', enum: ['bank', 'cash'] },
        openingBalanceCents: { ...money, minimum: -Number.MAX_SAFE_INTEGER },
        openingDate: date, includeInBalance: { type: 'boolean' },
      }, ['id', 'holderId', 'name', 'kind', 'openingBalanceCents', 'openingDate', 'includeInBalance']),
      async (request, reply) => {
        if (!validDate(request.body.openingDate)) return invalidDate(reply)
        return save(reply, request.body.id, () => addAccount(database, request.params.workspaceId, request.body))
      })

    ledger.post<{ Params: WorkspaceParams; Body: CardInput }>('/ledger/cards',
      bodySchema({
        id: uuid, holderId: uuid, paymentAccountId: uuid, name,
        lastFour: { type: 'string', pattern: '^[0-9]{4}$' },
        limitCents: { ...money, minimum: 0 }, closingDay: day, dueDay: day,
      }, ['id', 'holderId', 'name', 'limitCents', 'closingDay', 'dueDay']),
      (request, reply) => save(reply, request.body.id, () => addCard(database, request.params.workspaceId, request.body)))

    ledger.post<{ Params: WorkspaceParams; Body: EntryInput }>('/ledger/entries',
      bodySchema({
        id: uuid, kind: entryKind, instrumentId: uuid,
        description: { type: 'string', minLength: 1, maxLength: 160 },
        amountCents: { ...money, minimum: 1 }, occurredOn: date,
      }, ['id', 'kind', 'instrumentId', 'description', 'amountCents', 'occurredOn']),
      async (request, reply) => {
        if (!validDate(request.body.occurredOn)) return invalidDate(reply)
        return save(reply, request.body.id, () => addEntry(database, request.params.workspaceId, request.body))
      })
  }, { prefix: '/api/workspaces/:workspaceId' })
}
