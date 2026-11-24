import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Access } from './access.tsx'
import './style.css'

const messages = {
  loading: 'Verificando conexão com o banco de dados…',
  ready: 'Banco de dados conectado.',
  unavailable: 'Banco de dados indisponível.',
}

function DatabaseStatus() {
  const [status, setStatus] = useState<keyof typeof messages>('loading')

  useEffect(() => {
    const controller = new AbortController()

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        const health: unknown = await response.json()
        const ready = response.ok &&
          typeof health === 'object' && health !== null &&
          'status' in health && health.status === 'ok'
        if (!controller.signal.aborted) setStatus(ready ? 'ready' : 'unavailable')
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable')
      }
    }

    void checkHealth()
    return () => controller.abort()
  }, [])

  return (
    <p className="database-status" role="status" data-state={status}>{messages[status]}</p>
  )
}

function App() {
  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Auto Finance</h1>
        <DatabaseStatus />
      </header>
      <Access />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
