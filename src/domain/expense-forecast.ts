type Amounts = { plannedCents: string; confirmedCents: string | null; actualCents: string | null }

export function confirmedAmount(row: Amounts) {
  return row.actualCents ?? row.confirmedCents
}

export function expenseTotals(rows: Amounts[]) {
  let planned = 0n
  let confirmed = 0n
  let pending = 0n
  for (const row of rows) {
    const estimate = BigInt(row.plannedCents)
    const current = confirmedAmount(row)
    planned += estimate
    if (current === null) pending += estimate
    else confirmed += BigInt(current)
  }
  const total = pending + confirmed
  return { planned, pending, confirmed, total, difference: total - planned }
}
