// src/pages/user/UserProfile.tsx
// /user/profile — Figma 105:12516. The logged-in admin's own profile, rendered
// with the same three-column layout as /admins/:id (Figma 53:6344). Reuses
// AdminDetails directly by passing the auth user's id as an override; the
// layout/data plumbing lives in one place so a future polish on either page
// flows to both.
import { useAuth } from '@/hooks/useAuth'
import { AdminDetails } from '@/pages/admins/AdminDetails'

export function UserProfile() {
  const { user } = useAuth()
  return <AdminDetails adminId={user?.id} />
}
