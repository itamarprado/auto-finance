import { insertWorkspace } from '../database/workspaces.ts'
import type { PrismaClient } from '../generated/prisma/client.ts'
import { hashPassword, isValidUsername } from './passwords.ts'

export interface LocalAccount {
  username: string
  displayName: string
  workspaceName: string
  password: string
}

export async function createLocalAccount(
  prisma: PrismaClient,
  { username, displayName, workspaceName, password }: LocalAccount,
): Promise<{ userId: string; workspaceId: string }> {
  if (!isValidUsername(username)) {
    throw new Error('Use de 3 a 64 caracteres minúsculos, números, ponto, hífen ou sublinhado no usuário.')
  }
  const passwordHash = await hashPassword(password)
  return prisma.$transaction(async (transaction) => {
    const { id: userId } = await transaction.user.create({
      data: { username, displayName }, select: { id: true },
    })
    await transaction.passwordCredential.create({
      data: { userId, passwordHash }, select: { userId: true },
    })
    const workspaceId = await insertWorkspace(transaction, { name: workspaceName, ownerId: userId })
    return { userId, workspaceId }
  })
}
