// src/pages/admins/AdminsList.tsx
// Admins list page. Renders the header title, a tabs/search
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
import { adminsApi, type Admin } from '@/services/api/users'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'
import { chatPathTo } from '@/services/chat/chatReducers'
import { useAuth } from '@/hooks/useAuth'
import { useDemoToast } from '@/lib/demoToast'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { formatAge } from '@/lib/formatAge'
import { pluralize } from '@/lib/pluralize'
import { AdminsCreate } from './AdminsCreate'

type AdminRowProps = {
  admin: Admin
  isTablet: boolean
  // A linha do admin logado: ele não pode excluir a si mesmo (backend responde
  // 400) nem se auto-desativar. A lixeira some e o Toggle vem desabilitado — em
  // vez de oferecer ações que só fariam round-trip e reverteriam feio.
  isSelf: boolean
  onToggle: (id: string, active: boolean) => void
  onOpen: (id: string) => void
  onDelete: (admin: Admin) => void
  onChat: (admin: Admin) => void
  onLocation: (admin: Admin) => void
}

function AdminRow({
  admin,
  isTablet,
  isSelf,
  onToggle,
  onOpen,
  onDelete,
  onChat,
  onLocation,
}: AdminRowProps) {
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
        paddingVertical: theme.padding.sm,
        // At tablet the row's left cluster (avatar + name + role + toggle)
        // and right cluster (3 action icons + chevron) can exceed the
        // sidebar-collapsed content width. Allow them to wrap onto two
        // lines so nothing gets clipped at the page edge.
        ...(isTablet ? ({ flexWrap: 'wrap', rowGap: theme.gap.s } as const) : null),
      }}
    >
      {/* Left cluster: user-info + divider + role + divider + toggle.
          The spec uses gap.2xl=32px between these. The DS theme tops out at
          gap.xl (also 32), so we hardcode 32 to be explicit. At tablet we
          wrap and shrink the inter-cluster gap because 32 px between every
          item plus the inner column widths overflows narrow viewports. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: isTablet ? theme.gap.m : 32,
          ...(isTablet ? ({ flexWrap: 'wrap', rowGap: theme.gap.s } as const) : null),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Avatar uri={admin.avatarUri} customSize={64} accessibilityLabel={admin.name} />
          <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 145 }}>
            {/* Name is Inter Bold 14 per the spec (not in the DS Text
                variant table, so override fontWeight inline). Pressable so a
                click on the name itself opens the admin detail page. */}
            <Pressable
              onPress={() => onOpen(admin.id)}
              accessibilityRole="link"
              accessibilityLabel={`Abrir perfil de ${admin.name}`}
            >
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {admin.name}
              </Text>
            </Pressable>
            <Text variant="body.m" color={theme.content.dark}>
              {formatAge(admin.age)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {/* The spec uses a humidity-drop glyph (humidity_mid) for the
                  blood-type indicator, tinted error/red. */}
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{ fontWeight: '700', fontSize: 16 }}
              >
                {admin.bloodType}
              </Text>
            </View>
          </View>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />
        {/* Role + specialization. Spec: role is bold
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
          disabled={isSelf}
          accessibilityLabel={`Ativar ${admin.name}`}
        />
      </View>
      {/* Right cluster: action icons (bin / chat / location) + chevron.
          Actions order: delete (bin) → chat → location,
          followed by a chevron-down affordance (the whole row is clickable
          per the spec but the chevron makes the affordance discoverable). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        {!isSelf ? (
          <ActionIcon
            icon="delete_icon"
            label={`Excluir ${admin.name}`}
            onPress={() => onDelete(admin)}
          />
        ) : null}
        <ActionIcon
          icon="chat_bubble"
          label={`Conversar com ${admin.name}`}
          onPress={() => onChat(admin)}
        />
        <ActionIcon
          icon="location_on"
          label={`Localização de ${admin.name}`}
          onPress={() => onLocation(admin)}
        />
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

function ActionIcon({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        backgroundColor: theme.surface.high,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={20} color={theme.content.dark} />
    </Pressable>
  )
}

export function AdminsList({
  initialTab = 'cadastrados',
}: {
  initialTab?: 'cadastrados' | 'cadastrar'
} = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const { show: showToast } = useDemoToast()
  const { user } = useAuth()
  const currentUserId = user?.id
  const [admins, setAdmins] = useState<Admin[]>([])
  const [removing, setRemoving] = useState<Admin | null>(null)
  const [tab, setTab] = useState<string>(initialTab)
  const [search, setSearch] = useState('')
  // Bump pra forçar o refetch após um cadastro novo: ao voltar do form o
  // incremento reexecuta o useEffect e a lista já mostra o admin recém-criado.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    adminsApi.list().then(({ data }) => {
      if (!cancelled && data) setAdmins([...data])
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const filtered = admins.filter((a) =>
    search.trim() ? a.name.toLowerCase().includes(search.toLowerCase()) : true,
  )

  // Toggle otimista: liga/desliga já na UI, confirma no backend (PATCH), e
  // reverte + avisa se falhar.
  async function handleToggle(id: string, active: boolean) {
    setAdmins((prev) => prev.map((a) => (a.id === id ? { ...a, active } : a)))
    const { error } = await adminsApi.setActive(id, active)
    if (error) {
      setAdmins((prev) => prev.map((a) => (a.id === id ? { ...a, active: !active } : a)))
      showToast('Erro', error.message)
    }
  }

  // Exclusão otimista (após confirmação): tira a linha da lista já, chama o
  // DELETE, e reinsere na posição original + avisa se o backend recusar (ex.:
  // 409 quando o admin tem registros vinculados).
  async function handleRemove(a: Admin) {
    setRemoving(null)
    const idx = admins.findIndex((x) => x.id === a.id)
    setAdmins((prev) => prev.filter((x) => x.id !== a.id))
    const { error } = await adminsApi.remove(a.id)
    if (error) {
      setAdmins((prev) => {
        if (prev.some((x) => x.id === a.id)) return prev
        const next = [...prev]
        next.splice(idx < 0 ? next.length : idx, 0, a)
        return next
      })
      showToast('Erro', error.message)
      return
    }
    showToast('Administrador excluído', `${a.name} foi removido do sistema`)
  }

  const isCreating = tab === 'cadastrar'

  return (
    <View testID="admins-page" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.dark}>
        {isCreating
          ? 'Cadastrar novo administrador'
          : `Você tem (${admins.length}) ${pluralize(
              admins.length,
              'administrador cadastrado',
              'administradores cadastrados',
            )}`}
      </Title>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
          // 429 px Tabs + 548 px SearchInput + gaps exceeds the content
          // column when the sidebar collapses at tablet; wrap so the
          // search drops below the tabs instead of being clipped.
          ...(isTablet ? ({ flexWrap: 'wrap' } as const) : null),
        }}
      >
        <View
          style={
            isTablet
              ? ({
                  flexBasis: 429,
                  flexGrow: 1,
                  flexShrink: 1,
                  minWidth: 280,
                } as const)
              : { width: 429 }
          }
        >
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
          <View
            style={
              isTablet
                ? { flexBasis: 280, flexGrow: 1, flexShrink: 1, maxWidth: 548 }
                : { flex: 1, maxWidth: 548 }
            }
          >
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
        <AdminsCreate
          onBack={() => {
            setTab('cadastrados')
            setReloadKey((k) => k + 1)
          }}
        />
      ) : (
        <View style={{ gap: theme.gap.m }}>
          {filtered.map((admin) => (
            <AdminRow
              key={admin.id}
              admin={admin}
              isTablet={isTablet}
              isSelf={admin.id === currentUserId}
              onToggle={handleToggle}
              onOpen={(adminId) => navigate(`/admins/${adminId}`)}
              onDelete={(a) => setRemoving(a)}
              // A rota precisa carregar a chave da conversa: `/chat` sem
              // destino abre sempre a conversa mais recente.
              onChat={(a) => navigate(chatPathTo(currentUserId ?? '', a.id))}
              onLocation={() => navigate('/maps/general')}
            />
          ))}
        </View>
      )}

      {removing ? (
        <ConfirmDialog
          title="Excluir administrador?"
          message={`${removing.name} será removido do sistema.`}
          confirmLabel="Excluir"
          confirmDanger
          onConfirm={() => handleRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </View>
  )
}
