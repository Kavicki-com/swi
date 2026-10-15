import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

// Rotas de gestão de usuários e administradores. O Supervisor que chega por
// endereço direto volta para a home; quem barra de verdade é o backend, que
// responde 403 nas escritas. Sessão sem nível vale Administrador.
export function AdminOnly() {
  const { user } = useAuth()
  if ((user?.level ?? 'ADMIN') !== 'ADMIN') return <Navigate to="/" replace />
  return <Outlet />
}
