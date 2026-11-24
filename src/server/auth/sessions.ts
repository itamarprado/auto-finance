import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'
import { inTransaction } from '../database/transaction.ts'
import { verifyPassword } from './passwords.ts'

export const sessionLifetimeSeconds = 12 * 60 * 60
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/

interface SessionUser {
  id: string
  username: string
  displayName: string
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export async function openSession(
  database: Pool,
  username: string,
  password: string,
  previousToken?: string,
): Promise<string | undefined> {
  const { rows: [credential] } = await database.query<{ user_id: string; password_hash: string }>(
    `SELECT c.user_id, c.password_hash
       FROM auto_finance.password_credentials AS c
       JOIN auto_finance.users AS u ON u.id = c.user_id
       WHERE u.username = $1`,
    [username],
  )
  const valid = await verifyPassword(password, credential?.password_hash)
  if (!credential || !valid) return undefined

  const token = randomBytes(32).toString('base64url')
  await inTransaction(database, async (client) => {
    if (previousToken && sessionTokenPattern.test(previousToken)) {
      await client.query('DELETE FROM auto_finance.auth_sessions WHERE token_hash = $1', [tokenDigest(previousToken)])
    }
    await client.query('DELETE FROM auto_finance.auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP')
    await client.query(
      `INSERT INTO auto_finance.auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + $3::integer * interval '1 second')`,
      [tokenDigest(token), credential.user_id, sessionLifetimeSeconds],
    )
  })
  return token
}

export async function sessionUser(database: Pool, token?: string): Promise<SessionUser | undefined> {
  if (!token || !sessionTokenPattern.test(token)) return undefined

  const { rows: [user] } = await database.query<SessionUser>(
    `SELECT u.id, u.username, u.display_name AS "displayName"
       FROM auto_finance.auth_sessions AS s
       JOIN auto_finance.users AS u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
    [tokenDigest(token)],
  )
  return user
}

export async function revokeSession(database: Pool, token?: string): Promise<void> {
  if (!token || !sessionTokenPattern.test(token)) return
  await database.query('DELETE FROM auto_finance.auth_sessions WHERE token_hash = $1', [tokenDigest(token)])
}
