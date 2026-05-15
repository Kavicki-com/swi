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
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import { employeesApi, EMPLOYEES_TOTAL, type Employee } from '@/services/mockApi/employees'
import { AdminsCreate } from '@/pages/admins/AdminsCreate'

type EmployeeRowProps = {
  employee: Employee
  onOpen: (id: string) => void
  onChat: (employee: Employee) => void
  onLocation: (employee: Employee) => void
}

function vitalsColor(status: Employee['vitalsStatus'], theme: ReturnType<typeof useTheme>) {
  if (status === 'critical') return theme.surface.error
  if (status === 'warning') return theme.surface.warning
  return theme.surface.success
}

function EmployeeRow({ employee, onOpen, onChat, onLocation }: EmployeeRowProps) {
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
        paddingVertical: theme.padding.s,
      }}
    >
      {/* Left cluster: avatar (with status dot) + name/age/blood + divider + role */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
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
            <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
              {employee.name}
            </Text>
            <Text variant="body.m" color={theme.content.dark}>
              {employee.age} anos
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
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

export function EmployeesList({
  initialTab = 'cadastrados',
}: {
  initialTab?: 'cadastrados' | 'cadastrar'
} = {}) {
  const theme = useTheme()
  const navigate = useNavigate()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [tab, setTab] = useState<string>(initialTab)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    let cancelled = false
    employeesApi.list().then(({ data }) => {
      if (!cancelled && data) setEmployees([...data])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = employees.filter((e) =>
    search.trim() ? e.name.toLowerCase().includes(search.toLowerCase()) : true,
  )

  const isCreating = tab === 'cadastrar'

  return (
    <View testID="employees-page" style={{ gap: theme.gap.m }}>
      <Title variant="title.s" color={theme.content.dark}>
        {isCreating
          ? 'Cadastrar novo funcionário'
          : `Você tem (${EMPLOYEES_TOTAL}) funcionários cadastrados`}
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
              placeholder="Pesquisar funcionários"
              onClear={() => setSearch('')}
            />
          </View>
        ) : null}
      </View>

      {isCreating ? (
        <AdminsCreate subject="funcionário" onBack={() => setTab('cadastrados')} />
      ) : (
        <>
          <View style={{ gap: theme.gap.s }}>
            {filtered.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                onOpen={(id) => navigate(`/employees/${id}`)}
                onChat={() => navigate('/chat')}
                onLocation={() => navigate('/maps/general')}
              />
            ))}
          </View>
          <Pagination
            current={page}
            // 1205 / 10 per page (Figma "1205 funcionários cadastrados").
            total={Math.ceil(EMPLOYEES_TOTAL / 10)}
            onChange={setPage}
          />
        </>
      )}
    </View>
  )
}
