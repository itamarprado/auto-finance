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

const integerFormatter = new Intl.NumberFormat('pt-BR')

export function formatBrlCents(value: string | bigint): string {
  const cents = BigInt(value)
  const absolute = cents < 0n ? -cents : cents
  const whole = integerFormatter.format(absolute / 100n)
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${cents < 0n ? '-' : ''}R$ ${whole},${fraction}`
}
