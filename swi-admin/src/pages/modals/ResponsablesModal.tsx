// src/pages/modals/ResponsablesModal.tsx
// /modals/responsables — Figma 165:24210. Centered modal that lets an
// author pick 1+ admins to review the report being created. Rendered as
// a full route per the existing routes.tsx convention (modals promoted to
// overlays in S5).
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Button,
  Icon,
  Radio,
  SearchInput,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { adminsApi, type Admin } from '@/services/mockApi/admins'
import { useDemoToast } from '@/lib/demoToast'
import { useBreakpoint } from '@/hooks/useBreakpoint'

function VerticalDivider() {
  const theme = useTheme()
  return <View style={{ width: 2, height: 56, backgroundColor: theme.content.lightGrey }} />
}

// One row of the modal — Figma 165:23941 Admin Card.
function AdminPickRow({
  admin,
  selected,
  isMobile,
  onToggle,
}: {
  admin: Admin
  selected: boolean
  isMobile: boolean
  onToggle: (next: boolean) => void
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        backgroundColor: theme.background,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        // Mobile: stack the left cluster on top of the Radio so the row
        // doesn't punch past the modal width.
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'center',
        justifyContent: 'space-between',
        gap: isMobile ? theme.gap.s : 0,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.m,
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.gap.s,
            ...(isMobile ? { flex: 1, minWidth: 0 } : null),
          }}
        >
          <Avatar
            uri={admin.avatarUri}
            customSize={isMobile ? 48 : 64}
            accessibilityLabel={admin.name}
          />
          <View style={{ gap: 4, ...(isMobile ? { flex: 1, minWidth: 0 } : { width: 145 }) }}>
            <View>
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {admin.name}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {admin.age} anos
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
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
        {!isMobile && <VerticalDivider />}
        <View style={{ gap: 4, ...(isMobile ? { flex: 1, minWidth: 0 } : { width: 186 }) }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {admin.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {admin.specialization}
          </Text>
        </View>
        {!isMobile && <VerticalDivider />}
      </View>

      <Radio
        label="Selecionar"
        checked={selected}
        onChange={onToggle}
        accessibilityLabel={`Selecionar ${admin.name} como responsável`}
      />
    </View>
  )
}

export function ResponsablesModal() {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const isMobile = useBreakpoint() === 'mobile'
  const [admins, setAdmins] = useState<ReadonlyArray<Admin>>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    adminsApi.list().then(({ data }) => {
      if (!cancelled && data) setAdmins(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      admins.filter((a) =>
        search.trim() ? a.name.toLowerCase().includes(search.toLowerCase()) : true,
      ),
    [admins, search],
  )

  const toggle = (id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  const dismiss = () => navigate(-1)

  const confirm = () => {
    const count = selected.size
    if (count === 0) {
      showToast('Nenhum responsável selecionado', 'Selecione ao menos um para continuar')
      return
    }
    showToast(
      'Responsáveis atribuídos',
      count === 1
        ? '1 responsável adicionado ao relatório'
        : `${count} responsáveis adicionados ao relatório`,
    )
    navigate(-1)
  }

  return (
    <View
      testID="responsables-modal-backdrop"
      style={{
        position: 'absolute' as unknown as 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.l,
      }}
    >
      <View
        testID="responsables-modal"
        style={{
          // Cap at the Figma desktop width but allow the modal to shrink to
          // the viewport on phones (the dialog backdrop already centers it).
          width: '100%',
          maxWidth: 720,
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.m,
          padding: theme.padding.m,
          gap: theme.gap.l,
        }}
      >
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Selecionar responsáveis
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            Atribua 1 ou mais responsáveis ao seu relatório, eles revisaram e farão comentários.
          </Text>
        </View>

        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Pesquisar"
          onClear={() => setSearch('')}
        />

        <View style={{ gap: theme.gap.s }}>
          {filtered.map((a) => (
            <AdminPickRow
              key={a.id}
              admin={a}
              selected={selected.has(a.id)}
              isMobile={isMobile}
              onToggle={(next) => toggle(a.id, next)}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: theme.gap.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Cancelar"
              variant="outline"
              fullWidth
              onPress={dismiss}
              accessibilityLabel="Cancelar seleção"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Continuar"
              variant="contained"
              fullWidth
              onPress={confirm}
              accessibilityLabel="Confirmar responsáveis"
            />
          </View>
        </View>
      </View>
    </View>
  )
}
