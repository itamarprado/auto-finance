import type { Pool } from 'pg'
import { inTransaction } from './transaction.ts'

export async function createWorkspace(
  database: Pool,
  { name, ownerId }: { name: string; ownerId: string },
): Promise<string> {
  return inTransaction(database, async (client) => {
    const { rows: [workspace] } = await client.query<{ id: string }>(
      'INSERT INTO auto_finance.workspaces (name) VALUES ($1) RETURNING id',
      [name],
    )
    await client.query(
      `INSERT INTO auto_finance.workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspace.id, ownerId],
    )
    return workspace.id
  })
}
