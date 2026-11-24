import { createApp } from './app.ts'
import { readConfig } from './config.ts'

let config
try {
  config = readConfig(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Configuração inválida.')
  process.exit(1)
}

const app = createApp(config, { logger: true, serveWeb: process.argv.includes('--serve-web') })

try {
  await app.listen({ host: '127.0.0.1', port: config.port })
} catch {
  console.error('Não foi possível iniciar a API na porta configurada.')
  await app.close()
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close() })
}
