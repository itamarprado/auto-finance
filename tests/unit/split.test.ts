import { expect, it } from 'vitest'
import { apportionCents } from '../../src/server/ledger/split-math.ts'

it('distribui o centavo excedente sem perder precisão em valores grandes', () => {
  expect(apportionCents(10000n, [1n, 1n, 1n])).toEqual([3334n, 3333n, 3333n])
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  const parts = apportionCents(maximum - 1n, [maximum - 2n, 2n])
  expect(parts).toEqual([maximum - 3n, 2n])
})

it('recalcula partes proporcionais após um estorno parcial ou integral', () => {
  expect(apportionCents(15001n, [10000n, 10000n])).toEqual([7501n, 7500n])
  expect(apportionCents(0n, [18000n, 6000n])).toEqual([0n, 0n])
})
