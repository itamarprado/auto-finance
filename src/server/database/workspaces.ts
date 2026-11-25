import type { Prisma, PrismaClient } from '../generated/prisma/client.ts'

interface NewWorkspace {
  name: string
  ownerId: string
}

interface AccessibleWorkspace {
  id: string
  name: string
  role: 'owner' | 'member'
}

const workspaceSelection = {
  role: true,
  workspace: { select: { id: true, name: true } },
} satisfies Prisma.WorkspaceMemberSelect

function toAccessibleWorkspace({ role, workspace }: Prisma.WorkspaceMemberGetPayload<{ select: typeof workspaceSelection }>): AccessibleWorkspace {
  if (role !== 'owner' && role !== 'member') throw new Error('Papel inválido no espaço financeiro.')
  return { ...workspace, role }
}

export async function createWorkspace(prisma: PrismaClient, workspace: NewWorkspace): Promise<string> {
  return prisma.$transaction((transaction) => insertWorkspace(transaction, workspace))
}

export async function insertWorkspace(transaction: Prisma.TransactionClient, { name, ownerId }: NewWorkspace): Promise<string> {
  const { id } = await transaction.workspace.create({ data: { name }, select: { id: true } })
  await transaction.workspaceMember.create({
    data: { workspaceId: id, userId: ownerId, role: 'owner' },
    select: { workspaceId: true },
  })
  return id
}

export async function listWorkspaces(prisma: PrismaClient, userId: string): Promise<AccessibleWorkspace[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: workspaceSelection,
    orderBy: [{ workspace: { name: 'asc' } }, { workspaceId: 'asc' }],
  })
  return memberships.map(toAccessibleWorkspace)
}

export async function findWorkspace(prisma: PrismaClient, userId: string, workspaceId: string): Promise<AccessibleWorkspace | undefined> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: workspaceSelection,
  })
  return membership ? toAccessibleWorkspace(membership) : undefined
}
