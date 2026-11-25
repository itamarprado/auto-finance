export type Cadence = 'weekly' | 'monthly' | 'yearly'

const dayMs = 86_400_000
const maxDate = '9999-12-31'
const dateFormatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit' })

export const todayInBrasilia = () => dateFormatter.format()
export const sqlDate = (date: string) => new Date(`${date}T00:00:00Z`)
export const dateText = (date: Date) => date.toISOString().slice(0, 10)

export function addDays(date: string, days: number): string {
  const result = new Date(sqlDate(date).getTime() + days * dayMs)
  return result.getUTCFullYear() > 9999 ? '9999-12-32' : dateText(result)
}

function inMonth(month: number, anchorDay: number): string {
  const date = new Date(0)
  date.setUTCFullYear(Math.floor(month / 12), month % 12 + 1, 0)
  date.setUTCDate(Math.min(anchorDay, date.getUTCDate()))
  return date.getUTCFullYear() > 9999 ? '9999-12-32' : dateText(date)
}

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
}

export function monthEnd(month: string): string {
  return inMonth(monthIndex(month), 31)
}

export function nextScheduled(startsOn: string, cadence: Cadence, from: string): string | undefined {
  if (from <= startsOn) return startsOn
  if (from > maxDate) return undefined
  if (cadence === 'weekly') {
    const elapsedDays = (sqlDate(from).getTime() - sqlDate(startsOn).getTime()) / dayMs
    const due = addDays(startsOn, Math.ceil(elapsedDays / 7) * 7)
    return due <= maxDate ? due : undefined
  }
  const start = monthIndex(startsOn)
  const step = cadence === 'yearly' ? 12 : 1
  const anchor = Number(startsOn.slice(8, 10))
  let month = start + Math.floor((monthIndex(from) - start) / step) * step
  if (inMonth(month, anchor) < from) month += step
  const due = inMonth(month, anchor)
  return due <= maxDate ? due : undefined
}
