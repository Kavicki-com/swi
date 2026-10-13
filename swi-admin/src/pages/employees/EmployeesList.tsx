// src/pages/employees/EmployeesList.tsx
// Employees list page. Same template as AdminsList but
// without the active toggle. Each row shows avatar + vitals status dot +
// name/age/blood + role/specialization + sector + action icons (chat,
// location) + expand chevron.
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Avatar,
  Button,
  Combobox,
  Icon,
  Pagination,
  SearchInput,
  Tabs,
  Text,
  Title,
  Toggle,
  type IconName,
  useTheme,
} from '@kavicki/swi-design-system'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  clampPage,
  pageCountOf,
  pageSlice,
} from './pagination'
import { approvalsApi, employeesApi, type Employee, type PendingUser } from '@/services/api/users'
import { AdminsCreate } from '@/pages/admins/AdminsCreate'
import { ConfirmDialog } from '@/pages/_shared/ConfirmDialog'
import { ancoraDe, reinserirAncorado } from '@/pages/_shared/optimisticList'
import { fullMapPath } from '@/pages/maps/mapFocus'
import { chatPathTo } from '@/services/chat/chatReducers'
import { useAuth } from '@/hooks/useAuth'
import { useDemoToast } from '@/lib/demoToast'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { formatAge } from '@/lib/formatAge'
import { pluralize } from '@/lib/pluralize'

type EmployeeRowProps = {
  employee: Employee
  onOpen: (id: string) => void
  onChat: (employee: Employee) => void
  onLocation: (employee: Employee) => void
  onDelete: (employee: Employee) => void
  onToggle: (id: string, active: boolean) => void
  isTablet: boolean
}

function vitalsColor(status: Employee['vitalsStatus'], theme: ReturnType<typeof useTheme>) {
  if (status === 'critical') return theme.surface.error
  if (status === 'warning') return theme.surface.warning
  return theme.surface.success
}

function EmployeeRow({
  employee,
  onOpen,
  onChat,
  onLocation,
  onDelete,
  onToggle,
  isTablet,
}: EmployeeRowProps) {
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
        // Padding vertical maior para cada card ter área de respiro, o mesmo
        // princípio aplicado em Admins.
        paddingVertical: theme.padding.sm,
        // Tablet: if the right cluster can't fit on the same line, allow it
        // to wrap below. Desktop/wide keep the strict single-row layout.
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
              {formatAge(employee.age)}
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
        {/* Vertical divider */}
        <View style={{ width: 1, height: 56, backgroundColor: theme.surface.high }} />
        {/* Active toggle. Mesma posição da AdminsList (fim do cluster esquerdo,
            depois do segundo divisor): as duas listas mostram a mesma ação sobre
            a mesma rota, e diverger de lugar faz o operador errar o alvo. */}
        <Toggle
          value={employee.active}
          onChange={(v) => onToggle(employee.id, v)}
          accessibilityLabel={`Ativar ${employee.name}`}
        />
      </View>
      {/* Right cluster: delete / chat / location action icons + expand chevron.
          Mesma ordem da lista de admins: duas listas irmãs com a fileira em
          ordens diferentes fazem o operador errar o alvo. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <ActionIcon
          icon="delete_icon"
          label={`Excluir ${employee.name}`}
          onPress={() => onDelete(employee)}
        />
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
// Campo que o worker não preencheu. Dizer o que falta é mais honesto que um
// traço mudo — o admin precisa saber que a informação NÃO existe, não que a
// tela esqueceu de carregar.
const NAO_INFORMADO = 'não informado'

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m, flex: 1 }}>
        <Avatar uri={pending.avatar || undefined} name={pending.name} size="l" />
        <View style={{ flexDirection: 'column', gap: theme.gap.xs }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {pending.name}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {pending.email}
          </Text>
          {/* O worker preenche isto no cadastro e o app manda junto. Aprovar
              sem ver CPF, contato e tipo sanguíneo é decidir às cegas numa
              ferramenta de segurança do trabalho. */}
          <Text testID={`pending-doc-${pending.id}`} variant="body.s" color={theme.content.medium}>
            {`CPF ${pending.cpf ?? NAO_INFORMADO} · ${pending.phone ?? NAO_INFORMADO}`}
          </Text>
          <Text
            testID={`pending-health-${pending.id}`}
            variant="body.s"
            color={theme.content.medium}
          >
            {`Sangue ${pending.bloodType ?? NAO_INFORMADO} · ${
              pending.city ? `${pending.city}${pending.uf ? `/${pending.uf}` : ''}` : NAO_INFORMADO
            }`}
          </Text>
          <Text variant="body.s" color={theme.content.medium}>
            Solicitado em {requestedAt}
          </Text>
        </View>
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
  // Pro destino do chat: a conversa determinística entre eu e o clicado.
  const { user } = useAuth()
  const myId = user?.id ?? ''
  const [employees, setEmployees] = useState<Employee[]>([])
  const [pendentes, setPendentes] = useState<PendingUser[]>([])
  // true enquanto o fetch da aba Pendentes está em voo. Começa true quando a
  // aba inicial já é 'pendentes' pra não piscar o empty state antes do fetch.
  const [loadingPendentes, setLoadingPendentes] = useState(initialTab === 'pendentes')
  const [rejecting, setRejecting] = useState<PendingUser | null>(null)
  const [tab, setTab] = useState<string>(initialTab)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  // Bump pra forçar o refetch da lista "cadastrados" após um cadastro novo:
  // ao voltar do form, o incremento reexecuta o useEffect e a lista já mostra
  // o usuário recém-criado.
  const [reloadKey, setReloadKey] = useState(0)
  // Alvo da confirmação de exclusão. Guarda o funcionário INTEIRO, não o id: a
  // reinserção no rollback precisa da linha de volta, e relistar o servidor só
  // pra desfazer piscaria a tela.
  const [removing, setRemoving] = useState<Employee | null>(null)
  // Ids que ESTA tela tirou da lista e cuja saída o backend ainda não desmentiu.
  // Uma resposta de list() em voo foi montada no servidor ANTES do DELETE, então
  // aplicá-la crua ressuscita a linha recém-excluída. Ref, e não state: quem lê
  // é o callback do fetch, que precisa do valor do MOMENTO da resposta, não do
  // que ficou fechado no render que disparou a chamada.
  const removidosRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    employeesApi.list().then(({ data }) => {
      if (!cancelled && data) setEmployees(data.filter((e) => !removidosRef.current.has(e.id)))
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

  // Exclusão otimista (depois da confirmação): tira a linha já, chama o DELETE,
  // e devolve a linha à POSIÇÃO original se o backend recusar. Recusa aqui é o
  // caminho esperado, não a exceção: quem trabalhou acumula jornada, tarefa e
  // relatório, e o backend responde 409 mandando desativar em vez de excluir.
  // Toggle otimista: liga ou desliga já na UI, confirma no backend (PATCH), e
  // reverte mais avisa se falhar. Mesma régua do handleToggle da AdminsList,
  // sobre a mesma rota. Sem isto, o 409 do DELETE mandava desativar e apontava
  // pra um controle que a lista de funcionários não tinha.
  const handleToggle = async (id: string, active: boolean) => {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, active } : e)))
    const { error } = await employeesApi.setActive(id, active)
    if (error) {
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, active: !active } : e)))
      showToast('Erro', error.message)
    }
  }

  // Por isso o rollback preserva a ordem: relistar reordenaria a tela na cara
  // de quem só tentou excluir.
  const handleRemove = async (e: Employee) => {
    setRemoving(null)
    // Âncora, e não índice: durante o await a lista pode andar (outra exclusão
    // otimista, um refetch chegando), e um número guardado antes aponta pra
    // outro lugar. `pos < 0` é o caso em que a linha JÁ tinha saído da lista
    // (outro admin excluiu primeiro): aí não houve remoção otimista nenhuma, e
    // devolver o item pintaria uma linha fantasma que o servidor não lista mais.
    const { pos, anteriorId } = ancoraDe(employees, e.id)
    removidosRef.current.add(e.id)
    setEmployees((prev) => prev.filter((x) => x.id !== e.id))
    const { error } = await employeesApi.remove(e.id)
    if (error) {
      removidosRef.current.delete(e.id)
      if (pos >= 0) setEmployees((prev) => reinserirAncorado(prev, e, anteriorId))
      showToast('Erro', error.message)
      return
    }
    showToast('Funcionário excluído', `${e.name} foi removido do sistema`)
  }

  // Rollback otimista: reinsere `p` na posição original `idx` e de forma
  // idempotente. Se um refetch concorrente já recolocou o item, não duplica.
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
  // Paginação no cliente sobre o que já veio (teto de 200 do backend). A página
  // atual é saneada porque buscar ou excluir pode encolher a lista.
  const pageCount = pageCountOf(filtered.length, pageSize)
  const currentPage = clampPage(page, pageCount)
  const pageItems = pageSlice(filtered, page, pageSize)

  const isCreating = tab === 'cadastrar'
  const isPending = tab === 'pendentes'

  return (
    <View testID="employees-page" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.dark}>
        {isCreating
          ? 'Cadastrar novo funcionário'
          : isPending
            ? `Você tem (${pendentes.length}) ${pluralize(
                pendentes.length,
                'cadastro pendente',
                'cadastros pendentes',
              )}`
            : `Você tem (${employees.length}) ${pluralize(
                employees.length,
                'funcionário cadastrado',
                'funcionários cadastrados',
              )}`}
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
              onChangeText={(v) => {
                setSearch(v)
                setPage(1)
              }}
              placeholder="Pesquisar funcionários"
              onClear={() => {
                setSearch('')
                setPage(1)
              }}
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
          {/* Gap entre cards em theme.gap.m. */}
          <View style={{ gap: theme.gap.m }}>
            {pageItems.length ? (
              pageItems.map((employee) => (
                <EmployeeRow
                  key={employee.id}
                  employee={employee}
                  onOpen={(id) => navigate(`/employees/${id}`)}
                  // /chat sem destino faz o inbox abrir a conversa mais recente,
                  // a mesma pessoa em qualquer clique. O destino é a conversa
                  // determinística com o clicado.
                  onChat={(e) => navigate(chatPathTo(myId, e.id))}
                  // O mapa geral abre com a camada de operadores desligada, entao
                  // um pin sem destino cai num mapa vazio e exige um clique extra
                  // em "Operadores". O `focus` resolve os dois: liga a camada e
                  // centraliza neste funcionario.
                  onLocation={() => navigate(fullMapPath(employee.id))}
                  onDelete={setRemoving}
                  onToggle={handleToggle}
                  isTablet={isTablet}
                />
              ))
            ) : (
              <Text variant="body.m" color={theme.content.medium}>
                {search.trim()
                  ? 'Nenhum funcionário encontrado para a busca'
                  : 'Nenhum funcionário cadastrado'}
              </Text>
            )}
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.gap.m,
              paddingVertical: theme.padding.m,
            }}
          >
            <View style={{ width: 150 }}>
              <Combobox
                label="Por página"
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ label: String(n), value: String(n) }))}
                onChange={(v) => {
                  setPageSize(Number(v))
                  setPage(1)
                }}
                accessibilityLabel="Funcionários por página"
              />
            </View>
            <View style={{ width: 360 }}>
              <Pagination
                currentPage={currentPage}
                pageCount={pageCount}
                onPageChange={setPage}
              />
            </View>
            {/* Espaçador da mesma largura do seletor: mantém o Pagination centrado. */}
            <View style={{ width: 150 }} />
          </View>
        </>
      )}

      {removing ? (
        <ConfirmDialog
          title="Excluir funcionário?"
          message={`${removing.name} será removido do sistema.`}
          confirmLabel="Excluir"
          confirmDanger
          onConfirm={() => handleRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}

      {rejecting ? (
        <ConfirmDialog
          title="Rejeitar cadastro?"
          message={`${rejecting.name} não terá acesso ao sistema.`}
          confirmLabel="Rejeitar"
          confirmDanger
          onConfirm={() => handleReject(rejecting)}
          onCancel={() => setRejecting(null)}
        />
      ) : null}
    </View>
  )
}
