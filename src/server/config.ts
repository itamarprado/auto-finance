export interface Config {
  databaseUrl: string
  port: number
  production: boolean
}

export function readPostgresUrl(env: NodeJS.ProcessEnv, key: 'DATABASE_URL' | 'DATABASE_MIGRATION_URL'): string {
  const databaseUrl = env[key] ?? ''
  const parsedUrl = URL.parse(databaseUrl)
  if (
    !parsedUrl?.hostname ||
    !parsedUrl.username ||
    parsedUrl.pathname.length < 2 ||
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol)
  ) {
    throw new Error(`${key} deve indicar uma conexão PostgreSQL válida.`)
  }
  return databaseUrl
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const databaseUrl = readPostgresUrl(env, 'DATABASE_URL')

  const portValue = env.PORT ?? '3000'
  const port = Number(portValue)
  if (!/^\d+$/.test(portValue) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número inteiro de 1 a 65535.')
  }

  return { databaseUrl, port, production: env.NODE_ENV === 'production' }
}
