// src/pages/admins/AdminDetails.tsx
// Admin details — Figma 53:6344. Three-column worker layout shared with
// EmployeeDetails via `WorkerDetailsLayout`. This page owns admin data
// fetching and supplies the top-right "Editar perfil" CTA (text link, the
// admin-specific variant of the slot).
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { adminsApi, type Admin } from '@/services/mockApi/admins'
import { WorkerDetailsLayout } from '@/pages/_shared/WorkerDetailsLayout'

export function AdminDetails({ adminId }: { adminId?: string } = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const params = useParams<{ id: string }>()
  // Override hook: UserProfile mounts <AdminDetails adminId={user.id} />
  // to reuse this layout for the logged-in admin's own profile page
  // (Figma 105:12516 user-profile).
  const id = adminId ?? params.id
  const [admin, setAdmin] = useState<Admin | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!id) return
    adminsApi.get(id).then(({ data }) => {
      if (!cancelled) {
        setAdmin(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <View testID="admin-details-loading" style={{ padding: 24 }}>
        <Text variant="body.m" color={theme.content.dark}>
          Carregando…
        </Text>
      </View>
    )
  }
  if (!admin) {
    return (
      <View testID="admin-details-empty" style={{ padding: 24, gap: theme.gap.s }}>
        <Title variant="title.s" color={theme.content.dark}>
          Administrador não encontrado
        </Title>
      </View>
    )
  }

  return (
    <WorkerDetailsLayout
      worker={admin}
      testID="admin-details"
      onBack={() => navigate('/admins')}
      backA11yLabel="Voltar para a lista de administradores"
      onOpenFullMap={() => navigate('/maps/general')}
      topRightAction={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Editar perfil do administrador"
          onPress={() => navigate('/user/settings')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.s,
          }}
        >
          <Text variant="body.m" color={theme.content.primary} style={{ fontWeight: '700' }}>
            Editar perfil
          </Text>
          <Icon name="edit" size={16} color={theme.content.primary} />
        </Pressable>
      }
    />
  )
}
