// src/pages/employees/EmployeesList.tsx
// Employees list page — Figma 53:5786. Same template as AdminsList but
// without the active toggle. Each row shows avatar + vitals status dot +
// name/age/blood + role/specialization + sector + action icons (chat,
// location) + expand chevron.
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Button,
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import { approvalsApi, employeesApi, type Employee, type PendingUser } from '@/services/api/users'
import { AdminsCreate } from '@/pages/admins/AdminsCreate'
import { useDemoToast } from '@/lib/demoToast'
import { useBreakpoint } from '@/hooks/useBreakpoint'

type EmployeeRowProps = {
  employee: Employee
  onOpen: (id: string) => void
  onChat: (employee: Employee) => void
  onLocation: (employee: Employee) => void
  isTablet: boolean
}

function vitalsColor(status: Employee['vitalsStatus'], theme: ReturnType<typeof useTheme>) {
  if (status === 'critical') return theme.surface.error
  if (status === 'warning') return theme.surface.warning
  return theme.surface.success
}

function EmployeeRow({ employee, onOpen, onChat, onLocation, isTablet }: EmployeeRowProps) {
  const theme = useTheme()
  return (
    <View
      testID={`employee-row-${employee.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        // QA cliente §2: padding vertical um pouco maior (8→12) pra cada card
        // ter melhor área de respiro (mesmo princípio aplicado a Admins).
        paddingVertical: theme.padding.sm,
        // Tablet: if the right cluster can't fit on the same line, allow it
        // to wrap below. Desktop/wide keep the strict single-row Figma layout.
        ...(isTablet ? ({ flexWrap: 'wrap', rowGap: theme.gap.s } as const) : null),
      }}
    >
      {/* Left cluster: avatar (with status dot) + name/age/blood + divider + role */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: isTablet ? 16 : 32 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          {/* Avatar with vitals status dot overlay at top-right. */}
          <View style={{ position: 'relative' }}>
            <Avatar uri={employee.avatarUri} customSize={64} accessibilityLabel={employee.name} />
            <View
              accessibilityLabel={`Status: ${employee.vitalsStatus}`}
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 14,
                height: 14,
                borderRadius: 999,
                backgroundColor: vitalsColor(employee.vitalsStatus, theme),
                borderWidth: 2,
                borderColor: theme.surface.standard,
              }}
            />
          </View>
          <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 165 }}>
            {/* Pressable so a click on the name itself opens the employee detail page. */}
            <Pressable
              onPress={() => onOpen(employee.id)}
              accessibilityRole="link"
              accessibilityLabel={`Abrir perfil de ${employee.name}`}
            >
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {employee.name}
              </Text>
            </Pressable>
            <Text variant="body.m" color={theme.content.dark}>
              {employee.age} anos
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{ fontWeight: '700', fontSize: 16 }}
              >
                {employee.bloodType}
              </Text>
            </View>
          </View>
        </View>
        {/* Vertical divider */}
        <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />
        {/* Role + specialization */}
        <View style={{ flexDirection: 'column', gap: theme.gap.xs, width: 220 }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {employee.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {employee.specialization}
          </Text>
        </View>
      </View>
      {/* Right cluster: chat / location action icons + expand chevron. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <ActionIcon
          icon="chat_bubble"
          label={`Conversar com ${employee.name}`}
          badge={employee.hasUnreadMessages}
          onPress={() => onChat(employee)}
        />
        <ActionIcon
          icon="location_on"
          label={`Localização de ${employee.name}`}
          onPress={() => onLocation(employee)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir detalhes de ${employee.name}`}
          onPress={() => onOpen(employee.id)}
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

// Pagination — Figma 53:5786 footer. Compact numbered buttons centered
// below the list, plus a forward-arrow CTA in surface.primary. Local
// implementation (no Pagination component in the DS yet); page state is
// purely visual since the mock seed has only 10 entries.
function Pagination({
  current,
  total,
  onChange,
}: {
  current: number
  total: number
  onChange: (page: number) => void
}) {
  const theme = useTheme()
  // Show up to 5 page numbers centered around `current`. For a tiny seed
  // (total <= 5) just show all pages.
  const window = 5
  const start = Math.max(1, Math.min(current - Math.floor(window / 2), total - window + 1))
  const pages = Array.from({ length: Math.min(window, total) }, (_, i) => start + i)
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.gap.xs,
        paddingVertical: theme.padding.m,
      }}
    >
      {pages.map((p) => {
        const isActive = p === current
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={`Página ${p}`}
            onPress={() => onChange(p)}
            style={{
              width: 32,
              height: 32,
              borderRadius: theme.border.radius.s,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isActive ? theme.surface.high : 'transparent',
            }}
          >
            <Text
              variant="body.m"
              color={isActive ? theme.content.dark : theme.content.medium}
              style={{ fontWeight: isActive ? '700' : '400' }}
            >
              {p}
            </Text>
          </Pressable>
        )
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Próxima página"
        onPress={() => onChange(Math.min(current + 1, total))}
        style={{
          width: 32,
          height: 32,
          borderRadius: theme.border.radius.s,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surface.primary,
        }}
      >
        <View style={{ transform: [{ rotate: '-90deg' }] }}>
          <Icon name="keyboard_arrow_down" size={16} color={theme.content.dark} />
        </View>
      </Pressable>
    </View>
  )
}

function ActionIcon({
  icon,
  label,
  badge = false,
  onPress,
}: {
  icon: IconName
  label: string
  badge?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ position: 'relative' }}>
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
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            width: 12,
            height: 12,
            borderRadius: 999,
            backgroundColor: theme.surface.error,
            borderWidth: 2,
            borderColor: theme.background,
          }}
        />
      ) : null}
    </View>
  )
}

// Fila de aprovação — uma linha por WORKER pendente. Composição de View +
// Text + Button do DS (não reimplementa primitiva): à esquerda nome/email/data
// da solicitação, à direita as ações Aprovar (verde) / Rejeitar (outline).
function PendingRow({
  pending,
  onApprove,
  onReject,
}: {
  pending: PendingUser
  onApprove: (p: PendingUser) => void
  onReject: (p: PendingUser) => void
}) {
  const theme = useTheme()
  // Guarda contra requestedAt inválido: Intl formataria "Invalid Date". Mostra
  // um traço neutro em vez de vazar o erro pro cliente.
  const parsed = new Date(pending.requestedAt)
  const requestedAt = Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR').format(parsed)
  return (
    <View
      testID={`pending-row-${pending.id}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.sm,
        gap: theme.gap.m,
        flexWrap: 'wrap',
        rowGap: theme.gap.s,
      }}
    >
      <View style={{ flexDirection: 'column', gap: theme.gap.xs }}>
        <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
          {pending.name}
        </Text>
        <Text variant="body.m" color={theme.content.dark}>
          {pending.email}
        </Text>
        <Text variant="body.s" color={theme.content.medium}>
          Solicitado em {requestedAt}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Button
          label="Aprovar"
          variant="contained"
          backgroundColor={theme.surface.primary}
          accessibilityLabel={`Aprovar ${pending.name}`}
          onPress={() => onApprove(pending)}
        />
        <Button
          label="Rejeitar"
          variant="outline"
          accessibilityLabel={`Rejeitar ${pending.name}`}
          onPress={() => onReject(pending)}
        />
      </View>
    </View>
  )
}

// Overlay de confirmação de rejeição — composição page-level (View + Title +
// Text + Button). Rejeitar é destrutivo, então exige confirmação; Aprovar é
// direto. O botão "Rejeitar" aqui tem label sem nome (só "Rejeitar") pra
// diferenciar do botão da linha ("Rejeitar {nome}").
function ConfirmReject({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: PendingUser
  onCancel: () => void
  onConfirm: (p: PendingUser) => void
}) {
  const theme = useTheme()
  // Escape fecha o diálogo (semântica de modal). Listener no window enquanto
  // o overlay está montado; removido no cleanup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
  return (
    <Pressable
      accessibilityLabel="Fechar"
      onPress={onCancel}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.m,
        zIndex: 1000,
      }}
    >
      {/* Card por cima do scrim: clique dentro dele é capturado aqui e NÃO
          propaga pro scrim (que fecharia). accessibilityViewIsModal marca o
          card como modal (aria-modal no react-native-web). */}
      <Pressable
        accessibilityViewIsModal
        onPress={() => {}}
        style={{
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.m,
          padding: theme.padding.l,
          gap: theme.gap.m,
          maxWidth: 420,
          width: '100%',
        }}
      >
        <Title variant="title.xs" color={theme.content.dark}>
          Rejeitar cadastro?
        </Title>
        <Text variant="body.m" color={theme.content.dark}>
          {pending.name} não terá acesso ao sistema.
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: theme.gap.s,
          }}
        >
          <Button
            label="Cancelar"
            variant="outline"
            accessibilityLabel="Cancelar"
            onPress={onCancel}
          />
          <Button
            label="Rejeitar"
            variant="contained"
            backgroundColor={theme.surface.error}
            accessibilityLabel="Rejeitar"
            onPress={() => onConfirm(pending)}
          />
        </View>
      </Pressable>
    </Pressable>
  )
}

export function EmployeesList({
  initialTab = 'cadastrados',
}: {
  initialTab?: 'cadastrados' | 'cadastrar' | 'pendentes'
} = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const { show: showToast } = useDemoToast()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [pendentes, setPendentes] = useState<PendingUser[]>([])
  // true enquanto o fetch da aba Pendentes está em voo. Começa true quando a
  // aba inicial já é 'pendentes' pra não piscar o empty state antes do fetch.
  const [loadingPendentes, setLoadingPendentes] = useState(initialTab === 'pendentes')
  const [rejecting, setRejecting] = useState<PendingUser | null>(null)
  const [tab, setTab] = useState<string>(initialTab)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // Bump pra forçar o refetch da lista "cadastrados" após um cadastro novo:
  // ao voltar do form, o incremento reexecuta o useEffect e a lista já mostra
  // o usuário recém-criado.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    employeesApi.list().then(({ data }) => {
      if (!cancelled && data) setEmployees([...data])
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (tab !== 'pendentes') return
    let cancelled = false
    setLoadingPendentes(true)
    approvalsApi.listPendingWorkers().then(({ data }) => {
      if (cancelled) return
      if (data) setPendentes([...data])
      setLoadingPendentes(false)
    })
    return () => {
      cancelled = true
    }
  }, [tab])

  // Rollback otimista: reinsere `p` na posição original `idx` e de forma
  // idempotente — se um refetch concorrente já recolocou o item, não duplica.
  const reinsertPending = (idx: number, p: PendingUser) => {
    setPendentes((prev) => {
      if (prev.some((x) => x.id === p.id)) return prev
      const next = [...prev]
      next.splice(idx < 0 ? next.length : idx, 0, p)
      return next
    })
  }

  // Aprovação é direta (otimista): tira o item da lista já, confirma no backend,
  // e reinsere na posição original + avisa se falhar.
  const handleApprove = async (p: PendingUser) => {
    const idx = pendentes.findIndex((x) => x.id === p.id)
    setPendentes((prev) => prev.filter((x) => x.id !== p.id))
    const { error } = await approvalsApi.approve(p.id)
    if (error) {
      reinsertPending(idx, p)
      showToast('Erro', error.message)
      return
    }
    showToast('Cadastro aprovado', `${p.name} foi aprovado`)
  }

  // Rejeição passa por confirmação (ConfirmReject) antes de chegar aqui — a
  // partir daí é otimista igual ao approve (rollback na posição original).
  const handleReject = async (p: PendingUser) => {
    const idx = pendentes.findIndex((x) => x.id === p.id)
    setRejecting(null)
    setPendentes((prev) => prev.filter((x) => x.id !== p.id))
    const { error } = await approvalsApi.reject(p.id)
    if (error) {
      reinsertPending(idx, p)
      showToast('Erro', error.message)
      return
    }
    showToast('Cadastro rejeitado', `${p.name} não terá acesso ao sistema`)
  }

  const filtered = employees.filter((e) =>
    search.trim() ? e.name.toLowerCase().includes(search.toLowerCase()) : true,
  )

  const isCreating = tab === 'cadastrar'
  const isPending = tab === 'pendentes'

  return (
    <View testID="employees-page" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.dark}>
        {isCreating
          ? 'Cadastrar novo funcionário'
          : isPending
            ? `Você tem (${pendentes.length}) cadastros pendentes`
            : `Você tem (${employees.length}) funcionários cadastrados`}
      </Title>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: theme.gap.m,
          // Tablet: if Tabs + Search can't fit, let Search wrap onto its own
          // row instead of being squeezed below its usable width.
          ...(isTablet ? ({ flexWrap: 'wrap' } as const) : null),
        }}
      >
        <View
          style={
            isTablet
              ? { flexBasis: 429, flexGrow: 1, flexShrink: 1, minWidth: 280 }
              : { width: 429 }
          }
        >
          <Tabs
            tabs={[
              { value: 'cadastrados', label: 'Cadastrados' },
              {
                value: 'pendentes',
                label: pendentes.length ? `Pendentes (${pendentes.length})` : 'Pendentes',
              },
              { value: 'cadastrar', label: 'Cadastrar' },
            ]}
            value={tab}
            onChange={setTab}
            fullWidth
            accessibilityLabel="Modo de visualização"
          />
        </View>
        {!isCreating && !isPending ? (
          <View style={{ flex: 1, maxWidth: 548 }}>
            <SearchInput
              value={search}
              onChangeText={setSearch}
              placeholder="Pesquisar funcionários"
              onClear={() => setSearch('')}
            />
          </View>
        ) : null}
      </View>

      {isCreating ? (
        <AdminsCreate
          subject="funcionário"
          onBack={() => {
            setTab('cadastrados')
            setReloadKey((k) => k + 1)
          }}
        />
      ) : isPending ? (
        <View style={{ gap: theme.gap.m }}>
          {pendentes.length ? (
            pendentes.map((pending) => (
              <PendingRow
                key={pending.id}
                pending={pending}
                onApprove={handleApprove}
                onReject={setRejecting}
              />
            ))
          ) : loadingPendentes ? (
            <Text variant="body.m" color={theme.content.medium}>
              Carregando…
            </Text>
          ) : (
            <Text variant="body.m" color={theme.content.medium}>
              Nenhum cadastro pendente
            </Text>
          )}
        </View>
      ) : (
        <>
          {/* QA cliente §2: gap entre cards de 8→16 (theme.gap.m). */}
          <View style={{ gap: theme.gap.m }}>
            {filtered.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                onOpen={(id) => navigate(`/employees/${id}`)}
                onChat={() => navigate('/chat')}
                onLocation={() => navigate('/maps/general')}
                isTablet={isTablet}
              />
            ))}
          </View>
          <Pagination
            current={page}
            // 10 por página sobre o total real carregado do backend.
            total={Math.max(1, Math.ceil(employees.length / 10))}
            onChange={setPage}
          />
        </>
      )}

      {rejecting ? (
        <ConfirmReject
          pending={rejecting}
          onCancel={() => setRejecting(null)}
          onConfirm={handleReject}
        />
      ) : null}
    </View>
  )
}
