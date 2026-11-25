const brasiliaDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function dateInBrasilia(instant = new Date()): string {
  return brasiliaDate.format(instant)
}

export function currentMonthBounds() {
  const from = `${dateInBrasilia().slice(0, 7)}-01`
  const end = new Date(`${from}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 1, 0)
  return { from, to: end.toISOString().slice(0, 10) }
}
