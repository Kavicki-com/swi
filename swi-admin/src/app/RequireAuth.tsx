import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { DemoBanner } from '@/components/DemoBanner'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  // Flex column chain anchored at the viewport: DemoBanner keeps its intrinsic
  // height at the top; the Outlet wrapper absorbs the remaining height via
  // `flex: 1 + minHeight: 0`. Full-bleed routes (ChatInbox) use `flex: 1` on
  // their own root to fill the wrapper. AppLayout-based routes keep their
  // own internal layout — `minHeight: 100vh` inside them is bounded by this
  // outer cap so they no longer overflow the viewport below the banner.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <DemoBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    </div>
  )
}
