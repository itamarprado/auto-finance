import { describe, expect, it } from 'vitest'
import { formatBrlCents, parseBrlCents } from '../../src/domain/money.ts'

describe('parseBrlCents', () => {
  it('converte reais e centavos sem usar aritmética decimal de ponto flutuante', () => {
    expect(parseBrlCents('19,99')).toBe(1999)
    expect(parseBrlCents('-4,2')).toBe(-420)
    expect(parseBrlCents('0,01')).toBe(1)
    expect(parseBrlCents('-0')).toBe(0)
  })

  it('rejeita entradas ambíguas ou fora da precisão suportada', () => {
    expect(() => parseBrlCents('1.234')).toThrow()
    expect(() => parseBrlCents('1,005')).toThrow()
    expect(() => parseBrlCents('90071992547410,00')).toThrow()
  })
})

describe('formatBrlCents', () => {
  it('preserva os centavos de saldos negativos e totais acima do limite dos números JavaScript', () => {
    expect(formatBrlCents('-101')).toBe('-R$ 1,01')
    expect(formatBrlCents('900719925474099112')).toBe('R$ 9.007.199.254.740.991,12')
  })
})
