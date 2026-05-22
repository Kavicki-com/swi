// src/pages/user/UserProfile.tsx
// /user/profile — Figma 105:12516. The logged-in admin's own profile, rendered
// with the same three-column layout as /admins/:id (Figma 53:6344). Reuses
// AdminDetails directly so a future polish on either page flows to both.
//
// Demo wire-up: the seed auth user (`u_seed_1` / "Admin Seed") has no entry in
// the admins mock list, which uses `admin-01`…`admin-NN`. For the demo the
// logged-in admin's profile is hardcoded to `admin-01` (Elisa Siqueira Jordão,
// the featured admin in the Figma frame). When the real backend lands, replace
// the constant with the actual mapping from auth user → admin record.
import { AdminDetails } from '@/pages/admins/AdminDetails'

const DEMO_SELF_ADMIN_ID = 'admin-01'

export function UserProfile() {
  return <AdminDetails adminId={DEMO_SELF_ADMIN_ID} />
}
