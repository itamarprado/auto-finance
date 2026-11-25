import type { FastifyInstance, FastifyReply } from 'fastify'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { confirmImport, importHistory, previewImport } from '../database/imports.ts'
import type { ImportConfirmation, ImportInput } from '../database/imports.ts'
import { FinancialInputError } from '../database/invoices.ts'
import { maxCsvBytes, maxCsvRows } from './import-csv.ts'

type Params = { workspaceId: string }
const uuid = { type: 'string', pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }
const params = { type: 'object', required: ['workspaceId'], properties: { workspaceId: uuid } }
const previewFields = { targetKind: { type: 'string', enum: ['account', 'card'] }, targetId: uuid,
  csv: { type: 'string', minLength: 1, maxLength: maxCsvBytes } }

function postSchema(properties: Record<string, object>) {
  return {
    bodyLimit: maxCsvBytes * 6 + 128 * 1024,
    schema: { params, body: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties } },
  }
}

async function respond(reply: FastifyReply, operation: () => Promise<unknown>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof FinancialInputError) return reply.code(error.status).send({ message: error.message })
    throw error
  }
}

export function registerImportRoutes(routes: FastifyInstance, prisma: PrismaClient) {
  routes.get<{ Params: Params }>('/ledger/imports', { schema: { params } }, (request) => importHistory(prisma, request.params.workspaceId))
  routes.post<{ Params: Params; Body: ImportInput }>('/ledger/imports/preview', postSchema(previewFields), (req, reply) =>
    respond(reply, () => previewImport(prisma, req.params.workspaceId, req.body)))
  routes.post<{ Params: Params; Body: ImportConfirmation }>('/ledger/imports/confirm', postSchema({
    ...previewFields, digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    choices: { type: 'array', maxItems: maxCsvRows, items: {
      type: 'object', required: ['line', 'action'], additionalProperties: false, properties: {
        line: { type: 'integer', minimum: 2, maximum: maxCsvRows + 1 },
        action: { type: 'string', enum: ['create', 'link', 'skip'] },
        reference: { type: 'string', pattern: '^(?:entry|payment):[0-9a-f-]{36}$' },
        acknowledged: { type: 'boolean' },
      },
    } },
  }), (req, reply) => respond(reply, () => confirmImport(prisma, req.params.workspaceId, req.body)))
}
