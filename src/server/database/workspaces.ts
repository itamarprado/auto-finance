import type { Pool, PoolClient } from 'pg'
import { inTransaction } from './transaction.ts'

interface NewWorkspace {
  name: string
  ownerId: string
}

interface AccessibleWorkspace {
  id: string
  name: string
  role: 'owner' | 'member'
}

export async function createWorkspace(
  database: Pool,
  workspace: NewWorkspace,
): Promise<string> {
  return inTransaction(database, (client) => insertWorkspace(client, workspace))
}

export async function insertWorkspace(client: PoolClient, { name, ownerId }: NewWorkspace): Promise<string> {
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
}

export async function listWorkspaces(database: Pool, userId: string): Promise<AccessibleWorkspace[]> {
  const { rows } = await database.query<AccessibleWorkspace>(
    `SELECT w.id, w.name, m.role
       FROM auto_finance.workspace_members AS m
       JOIN auto_finance.workspaces AS w ON w.id = m.workspace_id
       WHERE m.user_id = $1
       ORDER BY w.name, w.id`,
    [userId],
  )
  return rows
}

export async function findWorkspace(
  database: Pool,
  userId: string,
  workspaceId: string,
): Promise<AccessibleWorkspace | undefined> {
  const { rows: [workspace] } = await database.query<AccessibleWorkspace>(
    `SELECT w.id, w.name, m.role
       FROM auto_finance.workspace_members AS m
       JOIN auto_finance.workspaces AS w ON w.id = m.workspace_id
       WHERE m.user_id = $1 AND w.id = $2`,
    [userId, workspaceId],
  )
  return workspace
}
