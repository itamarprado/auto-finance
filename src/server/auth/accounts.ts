import type { Pool } from 'pg'
import { inTransaction } from '../database/transaction.ts'
import { insertWorkspace } from '../database/workspaces.ts'
import { hashPassword, isValidUsername } from './passwords.ts'

export interface LocalAccount {
  username: string
  displayName: string
  workspaceName: string
  password: string
}

export async function createLocalAccount(
  database: Pool,
  { username, displayName, workspaceName, password }: LocalAccount,
): Promise<{ userId: string; workspaceId: string }> {
  if (!isValidUsername(username)) {
    throw new Error('Use de 3 a 64 caracteres minúsculos, números, ponto, hífen ou sublinhado no usuário.')
  }
  const passwordHash = await hashPassword(password)
  return inTransaction(database, async (client) => {
    const { rows: [user] } = await client.query<{ id: string }>(
      'INSERT INTO auto_finance.users (username, display_name) VALUES ($1, $2) RETURNING id',
      [username, displayName],
    )
    await client.query(
      'INSERT INTO auto_finance.password_credentials (user_id, password_hash) VALUES ($1, $2)',
      [user.id, passwordHash],
    )
    const workspaceId = await insertWorkspace(client, { name: workspaceName, ownerId: user.id })
    return { userId: user.id, workspaceId }
  })
}
