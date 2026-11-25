const brasiliaDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function dateInBrasilia(instant = new Date()): string {
  return brasiliaDate.format(instant)
}
