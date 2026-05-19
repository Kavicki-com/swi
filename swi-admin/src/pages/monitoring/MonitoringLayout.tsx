// src/pages/monitoring/MonitoringLayout.tsx
// Shared chrome for the /monitoring/* screens (Figma 69:14731 alerts /
// 77:16587 good-conditions). Owns the KPI row, the "Alertas de Desgaste"
// title, the tabs, the search input and the user list — everything that
// stays identical when the user switches sub-routes.
//
// The Outlet slot sits between the KPI row and the title so child routes
// can inject a unique row (e.g. good-conditions adds 4 DonutCharts).
import { Fragment, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Avatar,
  BigNumbersCard,
  Button,
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  Toggle,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import {
  monitoringApi,
  type MonitoringKpi,
  type MonitoringAlertDetail,
  type MonitoringUserAlert,
} from '@/services/mockApi/monitoring'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useDemoToast } from '@/lib/demoToast'

// --- Shared row helpers ---

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
        paddingHorizontal: theme.padding.sm,
        paddingVertical: theme.padding.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={24} color={theme.content.dark} />
    </Pressable>
  )
}

function VerticalDivider() {
  const theme = useTheme()
  return <View style={{ width: 2, height: 56, backgroundColor: theme.content.lightGrey }} />
}

function AlertRow({ alert }: { alert: MonitoringAlertDetail }) {
  const theme = useTheme()
  // Per Figma: all alert row icons render in content.dark (white) regardless
  // of tone — tone-based colouring (error red / warning orange) didn't match
  // the design.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s, width: '100%' }}>
      <Icon name={alert.icon} size={28} color={theme.content.dark} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ fontWeight: '700', fontSize: 16 }}
        >
          {alert.title}
        </Text>
        <Text variant="body.m" color={theme.content.dark}>
          {alert.description}
        </Text>
      </View>
    </View>
  )
}

function AlertUserCard({
  user,
  expanded,
  onToggle,
  onDelete,
  onChat,
  onLocation,
  onViewExams,
  onCall,
  onPause,
}: {
  user: MonitoringUserAlert
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
  onChat: () => void
  onLocation: () => void
  onViewExams: () => void
  onCall: () => void
  onPause: () => void
}) {
  const theme = useTheme()
  const hasAlerts = user.alerts.length > 0

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Avatar uri={user.avatarUri} customSize={64} accessibilityLabel={user.name} />
          <View style={{ width: 220, gap: 4 }}>
            <View>
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {user.name}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {user.age} anos
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{ fontWeight: '700', fontSize: 16 }}
              >
                {user.bloodType}
              </Text>
            </View>
          </View>
        </View>
        <VerticalDivider />
        <View style={{ width: 186, gap: 4 }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {user.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {user.specialization}
          </Text>
        </View>
        <VerticalDivider />
        <Toggle
          defaultValue={user.active}
          accessibilityLabel={`Ativar/desativar monitoramento de ${user.name}`}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <ActionIcon icon="delete_icon" label={`Remover ${user.name}`} onPress={onDelete} />
        <ActionIcon icon="chat_bubble" label={`Chat com ${user.name}`} onPress={onChat} />
        <ActionIcon icon="location_on" label={`Localização de ${user.name}`} onPress={onLocation} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Recolher' : 'Expandir'} alertas de ${user.name}`}
        onPress={hasAlerts ? onToggle : undefined}
        disabled={!hasAlerts}
        style={{ paddingHorizontal: theme.padding.xs, paddingVertical: theme.padding.sm }}
      >
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <Icon name="keyboard_arrow_down" size={16} color={theme.content.dark} />
        </View>
      </Pressable>
    </View>
  )

  return (
    <View
      testID={`alert-user-${user.id}`}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        gap: theme.gap.m,
      }}
    >
      {header}
      {expanded && hasAlerts ? (
        <>
          <View style={{ height: 2, backgroundColor: theme.content.lightGrey, width: '100%' }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 51 }}>
            <View style={{ flex: 1, gap: theme.gap.sm }}>
              {user.alerts.map((a) => (
                <AlertRow key={a.id} alert={a} />
              ))}
            </View>
            <View style={{ width: 220, gap: theme.gap.sm }}>
              <Button
                label="Histórico de exames clínicos"
                variant="outline"
                labelColor={theme.content.primary}
                borderColor={theme.content.primary}
                fullWidth
                accessibilityLabel="Ver histórico de exames clínicos"
                onPress={onViewExams}
              />
              <Button
                label="Ligar para o funcionário"
                variant="outline"
                labelColor={theme.content.primary}
                borderColor={theme.content.primary}
                fullWidth
                accessibilityLabel="Ligar para o funcionário"
                onPress={onCall}
              />
              <Button
                label="Enviar alerta de pausa"
                variant="contained"
                backgroundColor={theme.surface.accent}
                fullWidth
                accessibilityLabel="Enviar alerta de pausa"
                onPress={onPause}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  )
}

// --- KPI two-row grid (wide breakpoint) ---

// Per Figma 1263:7972: row 1 = 4 BigNumbersCard in a 4-col grid; row 2 = 3
// transparent cells (no card BG) separated by 1px vertical dividers. Used at
// wide on every /monitoring/* tab — half-width on good-conditions (paired
// with the donut Outlet), full-width on alerts/desgastados. The grid-based
// row 2 (`1fr 1px 1fr 1px 1fr`) makes the cells stretch to match row 1's
// 4-col rhythm in both contexts so the alignment stays consistent.
function KpiTwoRowGrid({ kpis }: { kpis: ReadonlyArray<MonitoringKpi> }) {
  const theme = useTheme()
  const row2 = kpis.slice(4)
  return (
    <View style={{ gap: theme.gap.m, width: '100%' }}>
      {/* Row 1 — 4 BigNumbersCards. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: theme.gap.m,
          width: '100%',
        }}
      >
        {kpis.slice(0, 4).map((k) => (
          <BigNumbersCard key={k.id} value={k.value} label={k.label} icon={k.icon} />
        ))}
      </div>
      {/* Row 2 — 3 transparent cells with 1px×80 vertical dividers between.
          Grid keeps cells equal-width and dividers exactly between, so the
          pattern scales from half-width (good-conditions) to full-width
          (alerts/desgastados) without code changes. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1px 1fr 1px 1fr',
          alignItems: 'center',
          width: '100%',
        }}
      >
        {row2.map((k, i) => (
          <Fragment key={k.id}>
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                gap: theme.gap.s,
                padding: theme.padding.m,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={k.icon} size={20} color={theme.content.primary} />
              </View>
              <Text
                color={theme.content.dark}
                style={{
                  fontFamily: theme.fontFamily.title,
                  fontWeight: '700',
                  fontSize: theme.fontSize.xxl,
                  textAlign: 'center',
                }}
              >
                {String(k.value)}
              </Text>
              <Text
                color={theme.content.dark}
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: '500',
                  fontSize: theme.fontSize.sm,
                  textAlign: 'center',
                }}
              >
                {k.label}
              </Text>
            </View>
            {i < row2.length - 1 ? (
              <View
                style={{
                  width: 1,
                  height: 80,
                  backgroundColor: theme.content.lightGrey,
                  alignSelf: 'center',
                }}
              />
            ) : null}
          </Fragment>
        ))}
      </div>
    </View>
  )
}

// --- Layout component ---

const TAB_BY_PATH: Array<[match: string, tab: string]> = [
  ['/monitoring/good-conditions', 'excelentes'],
  ['/monitoring/desgastados', 'desgastados'],
  ['/monitoring/alerts', 'alertas'],
]

const PATH_BY_TAB: Record<string, string> = {
  excelentes: '/monitoring/good-conditions',
  desgastados: '/monitoring/desgastados',
  alertas: '/monitoring/alerts',
}

function activeTabFromPath(pathname: string): string {
  for (const [match, tab] of TAB_BY_PATH) {
    if (pathname.startsWith(match)) return tab
  }
  return 'alertas'
}

export function MonitoringLayout() {
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const isWide = breakpoint === 'wide'
  // At wide on the good-conditions route the page reorganises into a
  // side-by-side layout: 4 donuts (rendered by the Outlet child) on the LEFT,
  // BigNumbers in a 2-col × 4-row grid on the RIGHT. Alerts route keeps the
  // stacked layout because it has no donuts to pair with.
  const isGoodConditions = location.pathname.startsWith('/monitoring/good-conditions')
  const useWideSideBySide = isWide && isGoodConditions
  const { show: showToast } = useDemoToast()
  const [kpis, setKpis] = useState<ReadonlyArray<MonitoringKpi>>([])
  const [users, setUsers] = useState<ReadonlyArray<MonitoringUserAlert>>([])
  const [search, setSearch] = useState('')
  // Default expanded card only on /monitoring/alerts (Figma 69:14774).
  // emp-04 (Carlos Henrique Silva) is the first critical worker in the
  // canonical roster so the demo lands with the full alert detail visible.
  const initialExpanded = location.pathname === '/monitoring/alerts' ? 'emp-04' : null
  const [expandedId, setExpandedId] = useState<string | null>(initialExpanded)

  // Fetch once for the layout's lifetime. Tab switches don't re-fire these.
  useEffect(() => {
    let cancelled = false
    Promise.all([monitoringApi.kpis(), monitoringApi.alertUsers()]).then(([k, u]) => {
      if (cancelled) return
      if (k.data) setKpis(k.data)
      if (u.data) setUsers(u.data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filteredUsers = users.filter((u) =>
    search.trim() ? u.name.toLowerCase().includes(search.toLowerCase()) : true,
  )
  const tab = activeTabFromPath(location.pathname)

  return (
    <View
      testID="monitoring-layout"
      style={{
        gap: theme.gap.xl,
        // Cap content at Figma 1366 content-area (1041) only at the desktop
        // breakpoint. Tablet and wide both drop the cap so the page uses the
        // full viewport — at wide every /monitoring/* tab shares the stretched
        // layout (KPI two-row grid + side-by-side donuts for good-conditions,
        // full-width KPI grid + full-width tabs/list for the other tabs).
        ...(isTablet || isWide
          ? null
          : ({ maxWidth: 1041, alignSelf: 'center', width: '100%' } as const)),
      }}
    >
      {useWideSideBySide ? (
        // Wide + good-conditions side-by-side per Figma 1263:7972:
        //   LEFT  → BigNumbers 2-row grid (4 cards + 3 transparent w/ dividers)
        //   RIGHT → Donuts (single horizontal row, rendered by the Outlet)
        <View style={{ flexDirection: 'row', gap: theme.gap.l, alignItems: 'stretch' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <KpiTwoRowGrid kpis={kpis} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Outlet />
          </View>
        </View>
      ) : isWide ? (
        // Wide + non-good-conditions tabs (desgastados, alerts): all 7 KPIs
        // share one row of BigNumbersCards across the full content width.
        // The two-row transparent pattern is reserved for good-conditions
        // (where it sits beside the donut Outlet). Outlet stays mounted
        // (renders null for these tabs) so route lifecycles match.
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${kpis.length || 7}, 1fr)`,
              gap: theme.gap.m,
              width: '100%',
            }}
          >
            {kpis.map((k) => (
              <BigNumbersCard key={k.id} value={k.value} label={k.label} icon={k.icon} />
            ))}
          </div>
          <Outlet />
        </>
      ) : (
        <>
          {/* KPI row — shared at tablet/desktop. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
            }}
          >
            {kpis.map((k) => (
              <BigNumbersCard key={k.id} value={k.value} label={k.label} icon={k.icon} />
            ))}
          </View>

          {/* Child-route unique content (e.g. good-conditions stats row). */}
          <Outlet />
        </>
      )}

      {/* "Alertas de Desgaste" section — shared. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.s" color={theme.content.dark}>
          Alertas de Desgaste
        </Title>

        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ width: 492, position: 'relative' }}>
            <Tabs
              tabs={[
                { value: 'excelentes', label: 'Excelentes' },
                { value: 'desgastados', label: 'Desgastados' },
                { value: 'alertas', label: 'Alertas de Fadiga' },
              ]}
              value={tab}
              onChange={(v) => {
                const next = PATH_BY_TAB[v]
                if (next && next !== location.pathname) navigate(next)
              }}
              fullWidth
              accessibilityLabel="Filtro de status"
            />
            <View
              accessibilityLabel="3 alertas novos"
              // Anchored to the RIGHT edge of the Tabs container instead of a
              // fixed left:478 keyed to the Tabs' 492 width. -14 = -badgeWidth/2
              // so the pill sticks out half over the Tabs' right edge — and the
              // anchor works at any Tabs width as the page becomes responsive.
              style={{
                position: 'absolute',
                right: -14,
                top: -16,
                width: 28,
                height: 28,
                borderRadius: 999,
                backgroundColor: theme.surface.error,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
                +3
              </Text>
            </View>
          </View>
          <Button
            label="Ver Todos"
            variant="contained"
            accessibilityLabel="Ver todos os alertas"
            onPress={() => showToast('Lista completa de alertas')}
          />
        </View>

        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Pesquisar funcionário"
          onClear={() => setSearch('')}
        />

        <View style={{ gap: theme.gap.s }}>
          {filteredUsers.map((u) => (
            <AlertUserCard
              key={u.id}
              user={u}
              expanded={expandedId === u.id}
              onToggle={() => setExpandedId((prev) => (prev === u.id ? null : u.id))}
              onDelete={() =>
                showToast('Funcionário removido', `${u.name} foi removido do monitoramento`)
              }
              onChat={() => navigate('/chat')}
              onLocation={() => navigate('/maps/general')}
              onViewExams={() => navigate(`/employees/${u.id}`)}
              onCall={() => showToast('Chamada iniciada', `Ligando para ${u.name}`)}
              onPause={() =>
                showToast('Alerta de pausa enviado', `${u.name} foi notificado para parar`)
              }
            />
          ))}
        </View>
      </View>
    </View>
  )
}
