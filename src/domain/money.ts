export function parseBrlCents(decimal: string): number {
  const parts = /^(-?)(\d+)(?:,(\d{1,2}))?$/.exec(decimal)
  if (!parts) {
    throw new Error('Informe um valor em reais com até duas casas decimais.')
  }

  const [, sign, whole, fraction = ''] = parts
  const cents = Number(`${sign}${whole}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(cents)) {
    throw new Error('O valor em centavos excede o limite suportado.')
  }

  return cents === 0 ? 0 : cents
}
