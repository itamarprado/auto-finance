import { expect, it } from 'vitest'
import { addDays, monthEnd, nextScheduled } from '../../src/server/ledger/recurrence-calendar.ts'

it('ajusta dias 29 a 31 ao fim do mês sem perder a data original nos meses seguintes', () => {
  expect(nextScheduled('2024-01-31', 'monthly', '2024-02-01')).toBe('2024-02-29')
  expect(nextScheduled('2024-01-31', 'monthly', '2024-03-01')).toBe('2024-03-31')
  expect(nextScheduled('2024-02-29', 'yearly', '2025-01-01')).toBe('2025-02-28')
  expect(nextScheduled('2024-02-29', 'yearly', '2028-01-01')).toBe('2028-02-29')
  expect(monthEnd('0099-02-01')).toBe('0099-02-28')
})

it('calcula a próxima semana atravessando o ano e respeita o limite de datas da API', () => {
  expect(nextScheduled('2024-12-26', 'weekly', '2024-12-31')).toBe('2025-01-02')
  expect(nextScheduled('2024-12-26', 'weekly', '2025-01-02')).toBe('2025-01-02')
  expect(nextScheduled('9999-12-31', 'monthly', addDays('9999-12-31', 1))).toBeUndefined()
})
