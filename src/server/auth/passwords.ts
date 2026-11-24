import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const algorithm = 'scrypt-v1'
const saltLength = 16
const keyLength = 64
const options = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const encodedHashPattern = /^scrypt-v1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,63}$/

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value)
}

export function isValidPassword(value: string): boolean {
  const length = [...value].length
  return length >= 15 && length <= 128
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  if (!isValidPassword(password)) {
    throw new Error('A senha deve ter de 15 a 128 caracteres.')
  }
  const salt = randomBytes(saltLength)
  const key = await deriveKey(password, salt)
  return [algorithm, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, encodedHash?: string): Promise<boolean> {
  if (!isValidPassword(password)) return false

  const stored = encodedHashPattern.exec(encodedHash ?? '')
  // Mantém o custo de verificação quando a conta não existe.
  const salt = stored ? Buffer.from(stored[1], 'base64url') : Buffer.alloc(saltLength)
  const expected = stored ? Buffer.from(stored[2], 'base64url') : Buffer.alloc(keyLength)
  const key = await deriveKey(password, salt)
  return timingSafeEqual(key, expected) && stored !== null
}
