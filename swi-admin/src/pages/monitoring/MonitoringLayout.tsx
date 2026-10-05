// src/pages/monitoring/MonitoringLayout.tsx
// Shared chrome for the /monitoring/* screens (alerts /
// 77:16587 good-conditions). Owns the KPI row, the "Alertas de Desgaste"
// title, the tabs, the search input and the user list — everything that
// stays identical when the user switches sub-routes.
//
// The Outlet slot sits between the KPI row and the title so child routes
// can inject a unique row (e.g. good-conditions adds 4 DonutCharts).
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { RouteFallback } from '@/app/RouteFallback'
import {
  BigNumbersCard,
  Button,
  Icon,
  SearchInput,
  Tabs,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import {
  buildKpis,
  buildUserAlerts,
  monitoringApi,
  type MonitoringDirectory,
  type MonitoringKpi,
  type MonitoringTier,
  type MonitoringUserAlert,
} from '@/services/monitoring'
import { telemetryApi, type AlertQueueItem } from '@/services/api/telemetry'
import { notificationsApi } from '@/services/api/notifications'
import { subscribeTelemetryEvents } from '@/services/telemetry/telemetrySocket'
import { connectionStatus } from '@/services/realtime/connectionStatus'
import { useAdminTelemetry } from '@/hooks/useAdminTelemetry'
import { chatPathTo } from '@/services/chat/chatReducers'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useDemoToast } from '@/lib/demoToast'
import { formatBadgeCount } from '@/app/nav'
import type { MonitoringOutletContext } from './monitoringContext'
import { AlertUserCard } from './MonitoringAlertUserCard'

/** Espera depois do último aviso de condição antes de reler a fila. */
export const QUEUE_REFETCH_DEBOUNCE_MS = 1_000

// --- KPI two-row grid (wide breakpoint) ---

// Per the spec: row 1 = 4 BigNumbersCard in a 4-col grid; row 2 = 3
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

// Que tier cada aba mostra. A régua se anuncia "Filtro de status" e o badge
// vermelho conta os em fadiga, então listar a população inteira nas 3 rotas
// faria o número e a lista se contradizerem na mesma tela.
const TIER_BY_TAB: Record<string, MonitoringTier> = {
  excelentes: 'excelente',
  desgastados: 'desgastado',
  alertas: 'alerta-fadiga',
}

// Fallback pro caso do tier não vir preenchido (o seed mock não traz
// telemetria): o tom do alerta é consequência direta do tier.
function tierOf(u: MonitoringUserAlert): MonitoringTier {
  if (u.tier) return u.tier
  if (u.alerts.some((a) => a.tone === 'error')) return 'alerta-fadiga'
  return u.alerts.length > 0 ? 'desgastado' : 'excelente'
}

const EMPTY_BY_TAB: Record<string, string> = {
  alertas: 'Nenhum alerta aberto',
  desgastados: 'Ninguém com desgaste agora',
  excelentes: 'Ninguém com leitura atual e sem alerta',
}

export function MonitoringLayout() {
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  // Pro destino do chat: a conversa determinística entre eu e o clicado.
  const { user } = useAuth()
  const myId = user?.id ?? ''
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
  // Lista e resumo da empresa, relidos quando o socket avisa e, por
  // segurança, em intervalo fixo.
  const telemetry = useAdminTelemetry()
  const [directory, setDirectory] = useState<MonitoringDirectory | null>(null)
  const [queue, setQueue] = useState<ReadonlyArray<AlertQueueItem> | null>(null)
  const [queueFailed, setQueueFailed] = useState(false)
  const [pendingAlerts, setPendingAlerts] = useState<ReadonlySet<string>>(new Set())
  const [pausingId, setPausingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // "Ver Todos" derruba o filtro de tier sem sair da rota, mesmo padrão das
  // atividades do dashboard. Volta a false a cada troca de aba, senão a aba
  // seguinte abriria já sem filtro.
  const [showAllTiers, setShowAllTiers] = useState(false)

  // Cadastro da org: muda pouco, então é lido uma vez por montagem.
  useEffect(() => {
    let cancelled = false
    monitoringApi.directory().then(({ data }) => {
      if (!cancelled && data) setDirectory(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Fila de alertas: lida ao montar e de novo quando uma condição abre ou se
  // recupera. Vários avisos seguidos viram uma releitura só.
  const loadQueue = useCallback(async () => {
    const { data, error } = await monitoringApi.queue()
    if (error || !data) {
      setQueue(null)
      setQueueFailed(true)
      return
    }
    setQueue(data)
    setQueueFailed(false)
  }, [])

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    void loadQueue()
    const unsubscribe = subscribeTelemetryEvents({
      onSnapshot: () => {},
      onCondition: () => {
        if (debounce.current) clearTimeout(debounce.current)
        debounce.current = setTimeout(() => {
          debounce.current = null
          void loadQueue()
        }, QUEUE_REFETCH_DEBOUNCE_MS)
      },
    })
    // Avisos de condição que chegaram durante uma queda do socket se perderam:
    // a volta da conexão relê a fila inteira.
    const stopReconnect = connectionStatus.onReconnect(() => void loadQueue())
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
      unsubscribe()
      stopReconnect()
    }
  }, [loadQueue])

  const users = useMemo(
    () =>
      directory
        ? buildUserAlerts(directory.employees, telemetry.workers?.workers ?? null, queue ?? [])
        : [],
    [directory, telemetry.workers, queue],
  )

  // Quantos estão no tier de fadiga AGORA. Alimenta o badge das abas usando o
  // mesmo formatador do menu lateral, e o KPI da mesma tela.
  const fatigueCount = users.filter((u) => tierOf(u) === 'alerta-fadiga').length
  const fatigueBadge = formatBadgeCount(fatigueCount)

  const kpis: ReadonlyArray<MonitoringKpi> = buildKpis({
    admins: directory?.admins ?? 0,
    workers: directory?.employees.length ?? 0,
    pendingReports: directory?.pendingReports ?? 0,
    cameras: directory?.cameras ?? null,
    fatigueCount,
    summary: telemetry.summary,
  })

  const outletContext: MonitoringOutletContext = {
    summary: telemetry.summary,
    failed: telemetry.failed,
  }

  const tab = activeTabFromPath(location.pathname)
  const tierOfTab = TIER_BY_TAB[tab]
  const filteredUsers = users.filter((u) => {
    if (!showAllTiers && tierOfTab && tierOf(u) !== tierOfTab) return false
    return search.trim() ? u.name.toLowerCase().includes(search.toLowerCase()) : true
  })

  // Abre o primeiro card da aba de fadiga (o desenho mostra a tela com o
  // detalhe visível). Depende do id, e não da lista: a lista é recalculada a
  // cada releitura, e o card aberto não pode fechar sozinho por isso.
  const firstFatigueId = users.find((u) => tierOf(u) === 'alerta-fadiga')?.id ?? null
  useEffect(() => {
    setShowAllTiers(false)
    setExpandedId(tab === 'alertas' ? firstFatigueId : null)
  }, [tab, firstFatigueId])

  // A tela só muda com a resposta do servidor: reconhecer ou resolver troca o
  // alerta pelo estado que o backend devolveu, com quem triou e quando.
  const triage = async (alertId: string, action: 'acknowledge' | 'resolve') => {
    setPendingAlerts((prev) => new Set(prev).add(alertId))
    const { data, error } =
      action === 'acknowledge'
        ? await telemetryApi.acknowledgeAlert(alertId)
        : await telemetryApi.resolveAlert(alertId)
    setPendingAlerts((prev) => {
      const next = new Set(prev)
      next.delete(alertId)
      return next
    })
    if (error || !data) {
      showToast(
        action === 'acknowledge' ? 'Não foi possível reconhecer' : 'Não foi possível resolver',
        error?.message,
      )
      return
    }
    setQueue((prev) => (prev ?? []).map((a) => (a.id === alertId ? data : a)))
  }

  // Mesmo pedido de pausa do detalhe do funcionário: o backend notifica o app.
  const requestPause = async (target: MonitoringUserAlert) => {
    setPausingId(target.id)
    const { error } = await notificationsApi.requestPause(target.id)
    setPausingId(null)
    if (error) {
      showToast('Falha ao solicitar pausa', error.message)
      return
    }
    showToast('Pausa solicitada', `${target.name} foi notificado para pausar a atividade`)
  }

  const loading = telemetry.loading || directory === null
  const statusLine = loading
    ? 'Carregando…'
    : telemetry.failed
      ? 'Leitura indisponível no momento'
      : queueFailed
        ? 'Não foi possível carregar os alertas'
        : null

  return (
    <View
      testID="monitoring-layout"
      style={{
        gap: theme.gap.xl,
        // Cap content at the 1366px content-area (1041) only at the desktop
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
        // Wide + good-conditions side-by-side per the spec:
        //   LEFT  → BigNumbers 2-row grid (4 cards + 3 transparent w/ dividers)
        //   RIGHT → Donuts (single horizontal row, rendered by the Outlet)
        <View style={{ flexDirection: 'row', gap: theme.gap.l, alignItems: 'stretch' }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <KpiTwoRowGrid kpis={kpis} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* As sub-rotas chegam por React.lazy (ver App.tsx). A fronteira
                fica AQUI, e não só no AppLayout, pra que trocar de tab não
                substitua os KPIs, o título e a lista pelo fallback enquanto o
                chunk da tab carrega. Vale para os três branches de layout. */}
            <Suspense fallback={<RouteFallback />}>
              <Outlet context={outletContext} />
            </Suspense>
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
          <Suspense fallback={<RouteFallback />}>
            <Outlet context={outletContext} />
          </Suspense>
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
          <Suspense fallback={<RouteFallback />}>
            <Outlet context={outletContext} />
          </Suspense>
        </>
      )}

      {/* "Alertas de Desgaste" section — shared. */}
      <View style={{ gap: theme.gap.m }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.gap.s,
          }}
        >
          <Title variant="title.s" color={theme.content.dark}>
            Alertas de Desgaste
          </Title>
          {statusLine ? (
            <Text testID="monitoring-status" variant="body.s" color={theme.content.medium}>
              {statusLine}
            </Text>
          ) : null}
        </View>

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
              // Sem seleção enquanto "Ver Todos" está ativo: nenhuma das 3
              // abas descreve a lista completa (padrão do Dashboard:663).
              value={showAllTiers ? undefined : tab}
              onChange={(v) => {
                setShowAllTiers(false)
                const next = PATH_BY_TAB[v]
                if (next && next !== location.pathname) navigate(next)
              }}
              fullWidth
              accessibilityLabel="Filtro de status"
            />
            {/* Contagem REAL de quem está no tier de fadiga. Valor fixo aqui
                contradiria o KPI da mesma tela. Some quando não há ninguém:
                badge zerado é ruído. */}
            {fatigueBadge ? (
              <View
                accessibilityLabel={`${fatigueCount} alertas de fadiga`}
                // Anchored to the RIGHT edge of the Tabs container instead of a
                // fixed left:478 keyed to the Tabs' 492 width. -14 = -badgeWidth/2
                // so the pill sticks out half over the Tabs' right edge — and the
                // anchor works at any Tabs width as the page becomes responsive.
                style={{
                  position: 'absolute',
                  right: -14,
                  top: -16,
                  minWidth: 28,
                  height: 28,
                  paddingHorizontal: 6,
                  borderRadius: 999,
                  backgroundColor: theme.surface.error,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
                  {fatigueBadge}
                </Text>
              </View>
            ) : null}
          </View>
          <Button
            label="Ver Todos"
            variant="contained"
            accessibilityLabel="Ver todos os funcionários, sem filtro de status"
            onPress={() => setShowAllTiers(true)}
          />
        </View>

        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Pesquisar funcionário"
          onClear={() => setSearch('')}
        />

        {/* Gap em theme.gap.m: cards de alerta com respiro entre si. */}
        <View style={{ gap: theme.gap.m }}>
          {filteredUsers.map((u) => (
            <AlertUserCard
              key={u.id}
              user={u}
              expanded={expandedId === u.id}
              onToggle={() => setExpandedId((prev) => (prev === u.id ? null : u.id))}
              // /chat sem destino abre sempre a conversa mais recente.
              onChat={() => navigate(chatPathTo(myId, u.id))}
              onLocation={() => navigate('/maps/general')}
              onViewExams={() => navigate(`/employees/${u.id}`)}
              onPause={() => void requestPause(u)}
              pausing={pausingId === u.id}
              pendingAlerts={pendingAlerts}
              onAcknowledge={(id) => void triage(id, 'acknowledge')}
              onResolve={(id) => void triage(id, 'resolve')}
            />
          ))}
          {/* Lista vazia diz por quê, em vez de deixar a seção muda. */}
          {!loading && filteredUsers.length === 0 ? (
            <Text testID="monitoring-empty" variant="body.m" color={theme.content.medium}>
              {search.trim()
                ? 'Nenhum funcionário com esse nome'
                : showAllTiers
                  ? 'Nenhum funcionário cadastrado'
                  : (EMPTY_BY_TAB[tab] ?? 'Nenhum alerta aberto')}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  )
}
