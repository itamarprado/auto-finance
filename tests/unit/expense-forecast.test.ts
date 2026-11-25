import { expect, it } from 'vitest'
import { expenseTotals } from '../../src/domain/expense-forecast.ts'

it('compõe a previsão com o valor confirmado e as estimativas que ainda faltam', () => {
  expect(expenseTotals([
    { plannedCents: '18000', confirmedCents: '20500', actualCents: null },
    { plannedCents: '12000', confirmedCents: null, actualCents: null },
  ])).toEqual({ planned: 30000n, pending: 12000n, confirmed: 20500n, total: 32500n, difference: 2500n })
})

it('usa apenas um valor para uma ocorrência vinculada e considera confirmação de zero', () => {
  expect(expenseTotals([
    { plannedCents: '10000', confirmedCents: '12500', actualCents: '12500' },
    { plannedCents: '8000', confirmedCents: '0', actualCents: null },
  ])).toEqual({ planned: 18000n, pending: 0n, confirmed: 12500n, total: 12500n, difference: -5500n })
})
