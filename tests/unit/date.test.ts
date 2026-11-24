import { expect, it } from 'vitest'
import { dateInBrasilia } from '../../src/domain/date.ts'

it('muda a data na meia-noite de Brasília', () => {
  expect(dateInBrasilia(new Date('2026-12-01T02:59:59Z'))).toBe('2026-11-30')
  expect(dateInBrasilia(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12-01')
})
