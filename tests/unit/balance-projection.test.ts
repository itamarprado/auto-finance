import { expect, it } from 'vitest'
import { estimatedCardDueOn, projectionDays } from '../../src/server/database/balance-projection.ts'

it.each([
  ['2028-02-24', 25, 8, '2028-03-08'],
  ['2028-02-26', 25, 8, '2028-04-08'],
  ['2028-02-20', 20, 31, '2028-02-29'],
  ['2027-02-28', 31, 30, '2027-03-30'],
])('estima o vencimento da compra em %s', (purchase, closing, due, expected) => {
  expect(estimatedCardDueOn(purchase, closing, due)).toBe(expected)
})

it('apresenta um saldo diário exato mesmo acima da faixa segura de Number', () => {
  const row = { accountId: 'account', description: 'Sintético', source: 'recorded' as const }
  const result = projectionDays(9007199254740993n, [
    { ...row, key: '1', on: '2027-02-03', cents: '-100' },
    { ...row, key: '2', on: '2027-02-02', cents: '150' },
    { ...row, key: '3', on: '2027-02-02', cents: '-49' },
  ])
  expect(result.timeline.map(({ on, changeCents, balanceCents }) => [on, changeCents, balanceCents])).toEqual([
    ['2027-02-02', '101', '9007199254741094'],
    ['2027-02-03', '-100', '9007199254740994'],
  ])
  expect(result.projectedCents).toBe('9007199254740994')
})
