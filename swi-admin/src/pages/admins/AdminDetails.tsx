// src/pages/admins/AdminDetails.tsx
// Admin details — Figma 53:6344. Three-column worker layout shared with
// EmployeeDetails via `WorkerDetailsLayout`. This page owns admin data
// fetching and supplies the top-right "Editar perfil" CTA (text link, the
// admin-specific variant of the slot).
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system'
import { adminsApi, type Admin } from '@/services/api/users'
import { WorkerDetailsLayout } from '@/pages/_shared/WorkerDetailsLayout'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'
import { useLivePositions } from '@/hooks/useLivePositions'

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
  // Admin normalmente não tem heartbeat de posição (o /positions cobre os
  // workers). Sem posição o mini-mapa diz isso em vez de pinar numa coordenada
  // fixa como fazia antes.
  const positions = useLivePositions()
  const position = positions?.find((p) => p.id === id) ?? null

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
      worker={{
        ...admin,
        // Fase 3: vitais simulados plausíveis + selo no layout (fim do 0 bpm).
        ...(() => {
          const v = simulatedVitalsFor(admin.id, Date.now())
          return {
            bpm: v.bpm,
            pressure: v.pressure,
            fatigueRate: v.fatiguePct,
            effort: v.effortPct,
            fatigueMinutes: v.fatigueMinutes,
            statusLabel: v.statusLabel,
          }
        })(),
      }}
      position={position ? { lat: position.lat, lng: position.lng } : null}
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
          <Text
            variant="body.m"
            color={theme.content.primary}
            style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
          >
            Editar perfil
          </Text>
          <Icon name="edit" size={16} color={theme.content.primary} />
        </Pressable>
      }
    />
  )
}
