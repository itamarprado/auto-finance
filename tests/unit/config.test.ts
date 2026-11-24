import { describe, expect, it } from 'vitest'
import { readConfig } from '../../src/server/config.ts'

const databaseUrl = 'postgresql://synthetic@localhost/auto_finance'

describe('readConfig', () => {
  it('aceita PostgreSQL e usa a porta padrão', () => {
    expect(readConfig({ DATABASE_URL: databaseUrl })).toEqual({
      databaseUrl,
      port: 3000,
      production: false,
    })
  })

  it('recusa banco ou porta inválidos sem imprimir os valores recebidos', () => {
    expect(() => readConfig({})).toThrow('DATABASE_URL deve indicar uma conexão PostgreSQL válida.')
    expect(() => readConfig({ DATABASE_URL: 'https://invalid.test/db' }))
      .toThrow('DATABASE_URL deve indicar uma conexão PostgreSQL válida.')
    expect(() => readConfig({ DATABASE_URL: databaseUrl, PORT: '65536' }))
      .toThrow('PORT deve ser um número inteiro de 1 a 65535.')
  })
})
