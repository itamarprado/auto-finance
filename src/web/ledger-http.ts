export class LedgerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function ledgerRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new LedgerError(body.message ?? 'Não foi possível concluir a operação.', response.status)
  }
  return response.json() as Promise<T>
}

export function formatDate(date: string): string {
  return date.split('-').reverse().join('/')
}
