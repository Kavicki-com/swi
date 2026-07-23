// src/pages/modals/ResponsablesModal.tsx
// Figma 165:24210. Centered modal that lets an author pick 1+ admins to review
// the report being created.
//
// Dois modos:
//  1. CONTROLADO (props `onConfirm`/`onClose`) — o NewReport monta este overlay
//     dentro da própria árvore (sem trocar de rota), então o formulário
//     meio-preenchido NÃO desmonta. `onConfirm` recebe os NOMES dos admins
//     marcados (o backend guarda responsáveis só como nome), e o pai fecha o
//     overlay. `initialSelectedNames` pré-marca quem já foi escolhido.
//  2. FALLBACK (sem props) — segue vivendo na rota /modals/responsables como
//     antes (navigate(-1) + toast demo), pra não quebrar quem ainda a abrir
//     como rota.
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
import { adminsApi, type Admin } from '@/services/admins'
import { useDemoToast } from '@/lib/demoToast'

function VerticalDivider() {
  const theme = useTheme()
  return <View style={{ width: 2, height: 56, backgroundColor: theme.content.lightGrey }} />
}

// One row of the modal — Figma 165:23941 Admin Card.
function AdminPickRow({
  admin,
  selected,
  onToggle,
}: {
  admin: Admin
  selected: boolean
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Avatar uri={admin.avatarUri} customSize={64} accessibilityLabel={admin.name} />
          <View style={{ width: 145, gap: 4 }}>
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
        <VerticalDivider />
        <View style={{ width: 186, gap: 4 }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {admin.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {admin.specialization}
          </Text>
        </View>
        <VerticalDivider />
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

export type ResponsablesModalProps = {
  /**
   * MODO CONTROLADO. Recebe os NOMES dos admins marcados quando o autor confirma
   * — o backend guarda responsável só como nome (sem id/avatar). Presente ⇒ o
   * pai (NewReport) é dono do estado e do fechamento; ausente ⇒ modo rota.
   */
  onConfirm?: (selectedNames: string[]) => void
  /** MODO CONTROLADO. Fecha o overlay sem confirmar. Ausente ⇒ navigate(-1). */
  onClose?: () => void
  /**
   * Nomes já atribuídos — chegam pré-marcados. Lido só na MONTAGEM (semente do
   * estado interno). O pai deve remontar o overlay a cada abertura (`key`) pra
   * re-semear; reaproveitar a instância ignora mudanças posteriores no prop.
   */
  initialSelectedNames?: ReadonlyArray<string>
}

export function ResponsablesModal({
  onConfirm,
  onClose,
  initialSelectedNames,
}: ResponsablesModalProps = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const [admins, setAdmins] = useState<ReadonlyArray<Admin>>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    adminsApi.list().then(({ data }) => {
      if (cancelled || !data) return
      setAdmins(data)
      // Pré-marca por nome só depois de ter a lista (o estado é keyed por id, e
      // só aqui dá pra mapear nome→id). Roda uma vez na montagem — o contrato
      // pede remontagem por abertura.
      if (initialSelectedNames && initialSelectedNames.length > 0) {
        const names = new Set(initialSelectedNames)
        setSelected(new Set(data.filter((a) => names.has(a.name)).map((a) => a.id)))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semente lida só na montagem (ver JSDoc)
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

  const dismiss = () => {
    if (onClose) onClose()
    else navigate(-1)
  }

  const confirm = () => {
    // Nomes na ordem da lista carregada (estável), não na ordem de clique.
    const selectedNames = admins.filter((a) => selected.has(a.id)).map((a) => a.name)
    if (onConfirm) {
      onConfirm(selectedNames)
      return
    }
    // Fallback (rota standalone): mantém o comportamento demo de antes.
    showToast(
      'Responsáveis atribuídos',
      selectedNames.length === 1
        ? '1 responsável adicionado ao relatório'
        : `${selectedNames.length} responsáveis adicionados ao relatório`,
    )
    navigate(-1)
  }

  // O CTA fica travado sem ninguém marcado: o overlay existe pra ATRIBUIR, e
  // confirmar zero equivale a fechar (o que o Cancelar já faz). Espelha o
  // ResponsiblePicker das tarefas.
  const canConfirm = selected.size > 0

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
          width: 720,
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
              disabled={!canConfirm}
              onPress={confirm}
              accessibilityLabel="Confirmar responsáveis"
            />
          </View>
        </View>
      </View>
    </View>
  )
}
