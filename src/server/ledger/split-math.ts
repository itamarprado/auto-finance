/** Distribute full cents by largest remainder, breaking ties in input order. */
export function apportionCents(total: bigint, weights: readonly bigint[]): bigint[] {
  const weight = weights.reduce((sum, value) => sum + value, 0n)
  const shares = weights.map((value, index) => {
    const weighted = total * value
    return { index, cents: weighted / weight, remainder: weighted % weight }
  })
  const remaining = Number(total - shares.reduce((sum, share) => sum + share.cents, 0n))
  const byRemainder = [...shares].sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index
    : a.remainder > b.remainder ? -1 : 1)
  for (const share of byRemainder.slice(0, remaining)) share.cents += 1n
  return shares.map((share) => share.cents)
}
