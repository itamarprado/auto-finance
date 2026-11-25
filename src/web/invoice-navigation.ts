import { dateInBrasilia } from '../domain/date.ts'

interface InvoiceListRoute {
  workspaceId: string
  from: string
  to: string
  group?: string
}

export type InvoiceRoute = InvoiceListRoute & { detail?: { cardId: string; month: string } }

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const monthPattern = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/

export function relativeMonth(offset: number): string {
  const date = new Date(`${dateInBrasilia().slice(0, 7)}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}

export function defaultInvoiceRoute(workspaceId: string): InvoiceRoute {
  return { workspaceId, from: relativeMonth(-11), to: relativeMonth(0) }
}

export function readInvoiceRoute(): InvoiceRoute | null {
  const query = new URLSearchParams(window.location.search)
  const workspaceId = query.get('workspace')?.toLowerCase() ?? ''
  if (query.get('screen') !== 'faturas' || !uuid.test(workspaceId)) return null
  const defaults = defaultInvoiceRoute(workspaceId)
  const from = query.get('from') ?? ''
  const to = query.get('to') ?? ''
  const group = query.get('group')?.toLowerCase()
  const cardId = query.get('card')?.toLowerCase() ?? ''
  const month = query.get('cycle') ?? ''
  return {
    workspaceId, from: monthPattern.test(from) ? from : defaults.from, to: monthPattern.test(to) ? to : defaults.to,
    group: group === '' || (group && uuid.test(group)) ? group : undefined,
    detail: uuid.test(cardId) && monthPattern.test(month) ? { cardId, month } : undefined,
  }
}

export function writeInvoiceRoute(route: InvoiceRoute | null, mode: 'push' | 'replace' = 'push', fromList = false) {
  const url = new URL(window.location.href)
  for (const key of ['screen', 'workspace', 'from', 'to', 'group', 'card', 'cycle']) url.searchParams.delete(key)
  if (route) {
    url.searchParams.set('screen', 'faturas')
    url.searchParams.set('workspace', route.workspaceId)
    url.searchParams.set('from', route.from)
    url.searchParams.set('to', route.to)
    if (route.group !== undefined) url.searchParams.set('group', route.group)
    if (route.detail) {
      url.searchParams.set('card', route.detail.cardId)
      url.searchParams.set('cycle', route.detail.month)
    }
  }
  const state = { invoiceFromList: fromList }
  if (mode === 'replace') window.history.replaceState(state, '', url)
  else window.history.pushState(state, '', url)
}
