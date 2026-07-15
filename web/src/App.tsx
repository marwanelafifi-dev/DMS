import { useEffect, useState } from 'react'

type Health = { status: string; service: string; phase: number }

// nginx proxies /api -> api:8080 in the built image (see web/nginx.conf).
const API_BASE = '/api'

export default function App() {
  const [api, setApi] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setApi)
      .catch((e) => setError(String(e)))
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Enterprise DMS v7.4</h1>
      <p style={{ color: '#666' }}>Phase 0 scaffold — the vault, workflows, and RBAC land in later phases.</p>
      <section style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>API health</h2>
        {api && <pre style={{ color: 'green' }}>{JSON.stringify(api, null, 2)}</pre>}
        {error && <pre style={{ color: 'crimson' }}>API unreachable: {error}</pre>}
        {!api && !error && <p>Checking…</p>}
      </section>
    </main>
  )
}
