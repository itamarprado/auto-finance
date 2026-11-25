import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Ledger } from './ledger.tsx'
import { readInvoiceRoute, writeInvoiceRoute } from './invoice-navigation.ts'

interface Workspace {
  id: string
  name: string
  role: 'owner' | 'member'
}

interface Session {
  user: { username: string; displayName: string }
  workspaces: Workspace[]
}

const roleLabels = { owner: 'Proprietário', member: 'Membro' }

async function readSession(signal?: AbortSignal): Promise<Session | null> {
  const response = await fetch('/api/auth/session', { signal })
  if (response.status === 401) return null
  if (!response.ok) throw new Error('Falha ao consultar a sessão')
  return response.json() as Promise<Session>
}

function workspaceFromRoute(session: Session | null): Workspace | null {
  return session?.workspaces.find(({ id }) => id === readInvoiceRoute()?.workspaceId) ?? null
}

export function Access({ databaseStatus }: { databaseStatus: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)

  const expireSession = useCallback(() => {
    setSession(null)
    setActiveWorkspace(null)
    setError('Sua sessão terminou. Entre novamente.')
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    readSession(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setSession(result)
        setActiveWorkspace(workspaceFromRoute(result))
      })
      .catch(() => { if (!controller.signal.aborted) setError('Não foi possível verificar a sessão.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: fields.get('username'), password: fields.get('password') }),
      })
      if (response.status === 400 || response.status === 401) {
        setError('Usuário ou senha inválidos.')
        return
      }
      if (response.status === 429) {
        setError('Muitas tentativas. Aguarde um minuto.')
        return
      }
      if (!response.ok) throw new Error('Falha no login')
      const current = await readSession()
      if (!current) throw new Error('Sessão não iniciada')
      setSession(current)
      setActiveWorkspace(workspaceFromRoute(current))
    } catch {
      setError('Não foi possível entrar. Confira a conexão e tente novamente.')
    } finally {
      const password = form.elements.namedItem('password')
      if (password instanceof HTMLInputElement) password.value = ''
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Falha no logout')
      if (readInvoiceRoute()) writeInvoiceRoute(null, 'replace')
      setSession(null)
      setActiveWorkspace(null)
    } catch {
      setError('Não foi possível encerrar a sessão. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  async function openWorkspace(workspace: Workspace) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}`)
      if (response.status === 401) {
        expireSession()
        return
      }
      if (response.status === 404) {
        setActiveWorkspace(null)
        setError('O espaço financeiro não está disponível para esta conta.')
        return
      }
      if (!response.ok) throw new Error('Falha ao abrir o espaço')
      const details = await response.json() as Workspace
      const invoiceRoute = readInvoiceRoute()
      if (invoiceRoute && invoiceRoute.workspaceId !== details.id) writeInvoiceRoute(null, 'replace')
      setActiveWorkspace(details)
    } catch {
      setError('Não foi possível abrir o espaço financeiro.')
    } finally {
      setBusy(false)
    }
  }

  if (session && activeWorkspace) {
    return <Ledger
      key={activeWorkspace.id}
      workspace={activeWorkspace}
      databaseStatus={databaseStatus}
      chooseWorkspace={() => {
        if (readInvoiceRoute()) writeInvoiceRoute(null, 'replace')
        setActiveWorkspace(null)
        setError('')
      }}
      logout={() => { void logout() }}
      expireSession={expireSession}
      sessionError={error}
      busy={busy}
    />
  }

  return (
    <main className="panel">
      <header className="panel-header">
        <h1>Auto Finance</h1>
        {databaseStatus}
      </header>
      {loading ? <p className="muted access">Verificando sessão…</p> : (
    <section className="access" aria-label={session ? 'Acesso ao espaço financeiro' : 'Acesso local'}>
      {error && <p className="notice" role="alert">{error}</p>}
      {session ? (
        <>
          <div className="access-heading">
            <div>
              <h2>Olá, {session.user.displayName}</h2>
              <p className="muted">@{session.user.username}</p>
            </div>
            <button className="secondary" type="button" disabled={busy} onClick={() => { void logout() }}>Sair</button>
          </div>
          <h3>Seus espaços financeiros</h3>
          {session.workspaces.length ? (
            <ul className="workspaces">
              {session.workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <button
                    className="workspace"
                    type="button"
                    disabled={busy}
                    onClick={() => { void openWorkspace(workspace) }}
                  >
                    <strong>{workspace.name}</strong>
                    <span>{roleLabels[workspace.role]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Esta conta ainda não tem acesso a um espaço.</p>}
        </>
      ) : (
        <>
          <h2>Entrar</h2>
          <form method="post" onSubmit={(event) => { void login(event) }}>
            <label>
              Usuário
              <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
            </label>
            <label>
              Senha
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
          <p className="muted setup">Primeiro acesso? Crie a conta no terminal com <code>npm run auth:create-user -- usuario</code>.</p>
        </>
      )}
    </section>
      )}
    </main>
  )
}
