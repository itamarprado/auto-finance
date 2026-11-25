import passwordPrompt from '@inquirer/password'
import pg from 'pg'
import { createLocalAccount } from '../src/server/auth/accounts.ts'
import { isValidPassword, isValidUsername } from '../src/server/auth/passwords.ts'
import { readPostgresUrl } from '../src/server/config.ts'
import { createPrismaClient } from '../src/server/database/prisma.ts'

const [username = '', displayArgument, workspaceArgument] = process.argv.slice(2)
const displayName = displayArgument?.trim() ?? username
const workspaceName = workspaceArgument?.trim() ?? 'Espaço pessoal'

if (!process.stdin.isTTY || !isValidUsername(username) || !displayName || !workspaceName) {
  console.error('Use um terminal interativo. Comando: npm run auth:create-user -- usuario "Nome" "Espaço".')
  process.exit(1)
}

let database: pg.Pool | undefined
let prisma: ReturnType<typeof createPrismaClient> | undefined
try {
  const connectionString = readPostgresUrl(process.env, 'DATABASE_MIGRATION_URL')
  const password = await passwordPrompt({
    message: 'Senha da conta local',
    mask: '*',
    validate: (value) => isValidPassword(value) || 'Use de 15 a 128 caracteres.',
  })
  await passwordPrompt({
    message: 'Confirme a senha',
    mask: '*',
    validate: (value) => value === password || 'As senhas precisam coincidir.',
  })

  database = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000, max: 1 })
  prisma = createPrismaClient(database)
  await createLocalAccount(prisma, { username, displayName, workspaceName, password })
  console.log('Conta e espaço financeiro criados.')
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'P2002') {
    console.error('O usuário já existe.')
  } else if (error instanceof Error && error.name === 'ExitPromptError') {
    console.error('Criação de conta cancelada.')
  } else {
    console.error('Não foi possível criar a conta. Confira o comando, a credencial de migração e o esquema.')
  }
  process.exitCode = 1
} finally {
  try {
    await prisma?.$disconnect()
  } finally {
    await database?.end()
  }
}
