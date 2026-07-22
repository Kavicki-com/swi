import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  // Cadeia de flex column ancorada no viewport: o wrapper do Outlet absorve a
  // altura via `flex: 1 + minHeight: 0`. Rotas full-bleed (ChatInbox) usam
  // `flex: 1` na própria raiz pra preencher o wrapper. Rotas com AppLayout
  // mantêm o layout interno — o `minHeight: 100vh` delas fica limitado por
  // este teto externo e não estoura o viewport.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  )
}
