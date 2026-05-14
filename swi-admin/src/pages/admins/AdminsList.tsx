// src/pages/admins/AdminsList.tsx
// Admins list page — Figma 48:3923. Renders the header title, a tabs/search
// row, and one AdminRow per admin in the seed. Composed inside AppLayout
// (the sidebar + header are owned by AppLayout, this page provides the
// main content slot only).
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  Toggle,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import { adminsApi, type Admin } from '@/services/mockApi/admins'
import { AdminsCreate } from './AdminsCreate'

type AdminRowProps = {
  admin: Admin
  onToggle: (id: string, active: boolean) => void
  onOpen: (id: string) => void
}

function AdminRow({ admin, onToggle, onOpen }: AdminRowProps) {
  const theme = useTheme()
  return (
    <View
      testID={`admin-row-${admin.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
      }}
    >
      {/* Left cluster: user-info + divider + role + divider + toggle.
          Figma uses gap.2xl=32px between these. The DS theme tops out at
          gap.xl (also 32), so we hardcode 32 to be explicit. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Avatar uri={admin.avatarUri} customSize={64} accessibilityLabel={admin.name} />
          <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 145 }}>
            {/* Name is Inter Bold 14 per Figma 48:4889 (not in the DS Text
                variant table, so override fontWeight inline). */}
            <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
              {admin.name}
            </Text>
            <Text variant="body.m" color={theme.content.dark}>
              {admin.age} anos
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {/* Figma uses a humidity-drop glyph (humidity_mid) for the
                  blood-type indicator, tinted error/red. */}
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {admin.bloodType}
              </Text>
            </View>
          </View>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />
        {/* Role + specialization. Figma I48:4943;48:4901 spec: role is bold
            14 + specialization is regular 14, container width 186. */}
        <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 186 }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {admin.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {admin.specialization}
          </Text>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />
        {/* Active toggle */}
        <Toggle
          value={admin.active}
          onChange={(v) => onToggle(admin.id, v)}
          accessibilityLabel={`Ativar ${admin.name}`}
        />
      </View>
      {/* Right cluster: action icons (bin / chat / location) + chevron.
          Figma I48:4943;48:4941 actions order: delete (bin) → chat → location,
          followed by a chevron-down affordance (the whole row is clickable
          per Figma but the chevron makes the affordance discoverable). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <ActionIcon icon="delete_icon" label={`Excluir ${admin.name}`} />
        <ActionIcon icon="chat_bubble" label={`Conversar com ${admin.name}`} />
        <ActionIcon icon="location_on" label={`Localização de ${admin.name}`} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir detalhes de ${admin.name}`}
          onPress={() => onOpen(admin.id)}
          style={{
            paddingHorizontal: theme.padding.xs,
            paddingVertical: theme.padding.sm,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="keyboard_arrow_down" size={16} color={theme.content.dark} />
        </Pressable>
      </View>
    </View>
  )
}

function ActionIcon({ icon, label }: { icon: IconName; label: string }) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        backgroundColor: theme.surface.high,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={20} color={theme.content.dark} />
    </View>
  )
}

export function AdminsList({
  initialTab = 'cadastrados',
}: {
  initialTab?: 'cadastrados' | 'cadastrar'
} = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [tab, setTab] = useState<string>(initialTab)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    adminsApi.list().then(({ data }) => {
      if (!cancelled && data) setAdmins([...data])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = admins.filter((a) =>
    search.trim() ? a.name.toLowerCase().includes(search.toLowerCase()) : true,
  )

  function handleToggle(id: string, active: boolean) {
    setAdmins((prev) => prev.map((a) => (a.id === id ? { ...a, active } : a)))
  }

  const isCreating = tab === 'cadastrar'

  return (
    <View testID="admins-page" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.dark}>
        {isCreating
          ? 'Cadastrar novo administrador'
          : `Você tem (${admins.length}) administradores cadastrados`}
      </Title>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
        }}
      >
        <View style={{ width: 429 }}>
          <Tabs
            tabs={[
              { value: 'cadastrados', label: 'Cadastrados' },
              { value: 'cadastrar', label: 'Cadastrar' },
            ]}
            value={tab}
            onChange={setTab}
            fullWidth
            accessibilityLabel="Modo de visualização"
          />
        </View>
        {!isCreating ? (
          <View style={{ flex: 1, maxWidth: 548 }}>
            <SearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Pesquisar administrador"
              onClear={() => setSearch('')}
            />
          </View>
        ) : null}
      </View>

      {isCreating ? (
        <AdminsCreate onBack={() => setTab('cadastrados')} />
      ) : (
        <View style={{ gap: theme.gap.s }}>
          {filtered.map((admin) => (
            <AdminRow
              key={admin.id}
              admin={admin}
              onToggle={handleToggle}
              onOpen={(adminId) => navigate(`/admins/${adminId}`)}
            />
          ))}
        </View>
      )}
    </View>
  )
}
