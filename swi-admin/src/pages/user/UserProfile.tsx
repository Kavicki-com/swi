// src/pages/user/UserProfile.tsx
// /user/profile. The logged-in admin's own profile, rendered
// with the same three-column layout as /admins/:id. Reuses
// AdminDetails directly so a future polish on either page flows to both.
//
// O perfil é o do usuário DA SESSÃO (useAuth), como o AdminDetails prevê. Um
// id fixo no código levaria todo usuário real a "Administrador não encontrado".
import { AdminDetails } from '@/pages/admins/AdminDetails'
import { useAuth } from '@/hooks/useAuth'

export function UserProfile() {
  const { user } = useAuth()
  // Sem sessão o RequireAuth já redirecionou; o null aqui é só transição.
  if (!user) return null
  return <AdminDetails adminId={user.id} />
}
