import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { verifyPassword } from './passwords.ts'

export const sessionLifetimeSeconds = 12 * 60 * 60
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/

interface SessionUser {
  id: string
  username: string
  displayName: string
}

function tokenDigest(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(token).digest())
}

export async function openSession(
  prisma: PrismaClient,
  username: string,
  password: string,
  previousToken?: string,
): Promise<string | undefined> {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, passwordCredential: { select: { passwordHash: true } } },
  })
  const valid = await verifyPassword(password, user?.passwordCredential?.passwordHash)
  if (!user || !valid) return undefined

  const token = randomBytes(32).toString('base64url')
  const previousHash = previousToken && sessionTokenPattern.test(previousToken) ? tokenDigest(previousToken) : undefined
  await prisma.$transaction(async (transaction) => {
    const [{ now }] = await transaction.$queryRaw<[{ now: Date }]>`SELECT CURRENT_TIMESTAMP AS "now"`
    await transaction.authSession.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, ...(previousHash ? [{ tokenHash: previousHash }] : [])] },
    })
    await transaction.authSession.create({
      data: {
        tokenHash: tokenDigest(token), userId: user.id, createdAt: now,
        expiresAt: new Date(now.getTime() + sessionLifetimeSeconds * 1000),
      },
      select: { userId: true },
    })
  })
  return token
}

export async function sessionUser(prisma: PrismaClient, token?: string): Promise<SessionUser | undefined> {
  if (!token || !sessionTokenPattern.test(token)) return undefined

  const [user] = await prisma.$queryRaw<SessionUser[]>`
    SELECT u.id, u.username, u.display_name AS "displayName"
    FROM auto_finance.auth_sessions AS s
    JOIN auto_finance.users AS u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenDigest(token)} AND s.expires_at > CURRENT_TIMESTAMP
  `
  return user
}

export async function revokeSession(prisma: PrismaClient, token?: string): Promise<void> {
  if (!token || !sessionTokenPattern.test(token)) return
  await prisma.authSession.deleteMany({ where: { tokenHash: tokenDigest(token) } })
}
