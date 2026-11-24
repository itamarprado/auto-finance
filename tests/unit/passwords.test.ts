import { describe, expect, it } from 'vitest'
import { hashPassword, isValidPassword, verifyPassword } from '../../src/server/auth/passwords.ts'

describe('credencial por senha', () => {
  it('aceita de 15 a 128 caracteres, incluindo Unicode', () => {
    expect(isValidPassword('a'.repeat(14))).toBe(false)
    expect(isValidPassword('ação e organização financeira')).toBe(true)
    expect(isValidPassword('a'.repeat(128))).toBe(true)
    expect(isValidPassword('a'.repeat(129))).toBe(false)
  })

  it('usa sais distintos e verifica apenas a senha correspondente', async () => {
    const password = 'frase sintética exclusiva de teste'
    const hash = await hashPassword(password)
    const otherHash = await hashPassword(password)
    expect(hash).not.toBe(otherHash)
    expect(hash).not.toContain(password)
    await expect(verifyPassword(password, hash)).resolves.toBe(true)
    await expect(verifyPassword('outra frase sintética de teste', hash)).resolves.toBe(false)
    await expect(verifyPassword(password)).resolves.toBe(false)
  })
})
