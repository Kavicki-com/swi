// src/pages/_shared/WorkerDetailsLayout.tsx
// Shared 3-column worker details layout — used by AdminDetails (Figma 53:6344)
// and EmployeeDetails (Figma 54:6561). Pure presentational: takes a `worker`
// payload + a `topRightAction` slot for the page-specific CTA. The page owns
// data fetching, loading/empty states, and back/CTA navigation.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import type maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { useDemoToast } from '@/lib/demoToast'
import {
  Avatar,
  Button,
  Chip,
  Combobox,
  DonutChart,
  ExamInfoCard,
  Icon,
  LineCaloriesChart,
  Silhouette,
  Text,
  Title,
  elevation,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'

export type WorkerExamEntry = {
  id: string
  year: string
  date: string
  title: string
}

export type WorkerDetailsData = {
  name: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  gender?: 'male' | 'female'
  bpm?: number
  pressure?: string
  fatigueRate?: number
  effort?: number
  statusLabel?: string
  fatigueMinutes?: number
  allergies?: ReadonlyArray<string>
  examHistory?: ReadonlyArray<WorkerExamEntry>
}

export type WorkerDetailsLayoutProps = {
  worker: WorkerDetailsData
  testID: string
  onBack: () => void
  backA11yLabel: string
  onOpenFullMap: () => void
  topRightAction: ReactNode
}

// Mock caloric expenditure curves per period — the period combobox switches
// between these. The "today" curve mirrors Figma 105:12586 (intra-day shift
// timestamps); week/month aggregate to days/weeks so the X-axis labels make
// sense for the chosen window.
const CALORIES_DAY = [
  { time: '07:15', kcal: 41 },
  { time: '08:42', kcal: 57 },
  { time: '10:51', kcal: 62 },
  { time: '14:22', kcal: 38 },
  { time: '16:33', kcal: 55 },
  { time: '18:54', kcal: 49 },
  { time: '19:00', kcal: 22 },
  { time: '19:30', kcal: 19 },
]

const CALORIES_WEEK = [
  { time: 'Seg', kcal: 312 },
  { time: 'Ter', kcal: 285 },
  { time: 'Qua', kcal: 340 },
  { time: 'Qui', kcal: 298 },
  { time: 'Sex', kcal: 365 },
  { time: 'Sáb', kcal: 180 },
  { time: 'Dom', kcal: 95 },
]

const CALORIES_MONTH = [
  { time: 'Sem 1', kcal: 1820 },
  { time: 'Sem 2', kcal: 2010 },
  { time: 'Sem 3', kcal: 1950 },
  { time: 'Sem 4', kcal: 2180 },
]

const CALORIES_BY_PERIOD = {
  today: CALORIES_DAY,
  week: CALORIES_WEEK,
  month: CALORIES_MONTH,
} as const

// ESRI World Imagery — same satellite tile source the dashboard MapBanner
// and /maps/general use. Reused here for the mini-map in the user profile.
const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-imagery',
      type: 'raster' as const,
      source: 'esri-imagery',
    },
  ],
}

// Mini map embedded under the user profile. Shows a single LocationPin
// approximating the worker's last known position.
function MiniMap({
  worker,
  onOpenFullMap,
}: {
  worker: WorkerDetailsData
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  const lib = useMapLibre()
  const { show: showToast } = useDemoToast()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  useEffect(() => {
    if (!lib || !containerRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center: [-46.633, -23.55],
      zoom: 13,
      interactive: false,
      attributionControl: false,
    })
    mapRef.current = map
    // Marker DOM — Figma 105:12554 LocationPin = circular avatar (with
    // blue ring) + small triangular tail pointing down (anchors at the
    // tip of the tail on the map lat/lng).
    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'
    wrapper.style.alignItems = 'center'

    const avatarEl = document.createElement('div')
    avatarEl.style.width = '40px'
    avatarEl.style.height = '40px'
    avatarEl.style.borderRadius = '999px'
    avatarEl.style.background = theme.surface.medium
    avatarEl.style.backgroundImage = `url("${worker.avatarUri}")`
    // Zoom past the PNG's baked-in white ring so only the blue CSS ring shows.
    avatarEl.style.backgroundSize = '130%'
    avatarEl.style.backgroundPosition = 'center'
    avatarEl.style.boxShadow = `0 0 0 3px ${theme.surface.secondary}`

    const tail = document.createElement('div')
    tail.style.width = '0'
    tail.style.height = '0'
    tail.style.borderLeft = '6px solid transparent'
    tail.style.borderRight = '6px solid transparent'
    tail.style.borderTop = `8px solid ${theme.surface.secondary}`
    // Slight overlap with the avatar's bottom blue ring so the tail visually
    // connects without a gap.
    tail.style.marginTop = '-1px'

    wrapper.appendChild(avatarEl)
    wrapper.appendChild(tail)

    new lib.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat([-46.633, -23.55]).addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
    }
    // Intentionally excludes `theme.surface.secondary`: this effect mounts a
    // maplibre map + a DOM marker. Re-running on every theme reference change
    // would tear down and rebuild the map for an essentially-static colour
    // that never changes at runtime (the SWI theme is fixed dark mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker, lib])
  return (
    <View
      style={{
        height: 132,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <View style={{ position: 'absolute', left: 8, bottom: 8 }}>
        <Button
          label="Mapa completo"
          variant="contained"
          size="small"
          onPress={onOpenFullMap}
          accessibilityLabel="Ver mapa completo"
        />
      </View>
      {/* Camera affordance — Figma 105:12516 / 32:3363 ContainedButton
          (variant surface): surface.high bg, padding.sm, radius.m, elevation.sm. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver câmera da posição"
        onPress={() => showToast('Câmera da posição', `Stream ao vivo de ${worker.name}`)}
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          backgroundColor: theme.surface.high,
          borderRadius: theme.border.radius.m,
          paddingHorizontal: theme.padding.sm,
          paddingVertical: theme.padding.sm,
          alignItems: 'center',
          justifyContent: 'center',
          ...elevation.sm,
        }}
      >
        <Icon name="video_camera_back" size={20} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

// Inline stat — label + optional icon + value, all in one row.
// Figma 159:14123 / 159:16092 right-column stats: label always body.m bold
// (14), value usually body.s medium (12) in content.dark, except blood type
// which uses body.m regular (14) — passed via `valueVariant` to opt into that.
function InlineStat({
  label,
  value,
  icon,
  iconColor,
  valueVariant = 'body.s',
  valueWeight = '500',
}: {
  label: string
  value: string
  icon?: IconName
  iconColor?: string
  valueVariant?: 'body.s' | 'body.m'
  valueWeight?: '400' | '500'
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
        {label}
      </Text>
      {icon ? <Icon name={icon} size={20} color={iconColor ?? theme.content.dark} /> : null}
      <Text variant={valueVariant} color={theme.content.dark} style={{ fontWeight: valueWeight }}>
        {value}
      </Text>
    </View>
  )
}

export function WorkerDetailsLayout({
  worker,
  testID,
  onBack,
  backA11yLabel,
  onOpenFullMap,
  topRightAction,
}: WorkerDetailsLayoutProps) {
  const theme = useTheme()
  const genderLabel = worker.gender === 'male' ? 'Masculino' : 'Feminino'
  const genderIcon: IconName = worker.gender === 'male' ? 'admin_filled' : 'humidity_mid'
  // Percent with pt-BR locale (comma decimal): 62.5 → "62,5".
  const formatPct = (n: number) =>
    new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
      Math.round(n * 1000) / 10,
    )
  const fatiguePct = formatPct(worker.fatigueRate ?? 0)
  const effortPct = formatPct(worker.effort ?? 0)
  const [caloriesPeriod, setCaloriesPeriod] = useState('today')

  return (
    <View testID={testID} style={{ gap: theme.gap.m }}>
      {/* Top bar — Voltar (left, ghost text + chevron) + page-specific CTA
          (right, supplied via topRightAction slot). Per Figma 53:6344 /
          54:6561 the right CTA differs: AdminDetails uses an "Editar perfil"
          text link, EmployeeDetails uses a contained "Solicitar Pausa" Button. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backA11yLabel}
          onPress={onBack}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: theme.padding.s,
            paddingVertical: theme.padding.s,
          }}
        >
          {/* Use rotated keyboard_arrow_down as a left chevron since the DS
              doesn't ship a keyboard_arrow_left yet. */}
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icon name="keyboard_arrow_down" size={16} color={theme.content.primaryLight} />
          </View>
          <Text
            variant="body.m"
            color={theme.content.primaryLight}
            style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
          >
            Voltar
          </Text>
        </Pressable>
        {topRightAction}
      </View>

      {/* Three-column body */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.gap.m }}>
        {/* LEFT column — profile + mini map + exam history.
            Width 380 leaves room for silhouette + right column 459 within
            the visible content area at default viewport. Figma spec is 415
            but we shave 35px so the silhouette doesn't overlap right col. */}
        <View style={{ width: 380, gap: theme.gap.s }}>
          {/* Profile (no card bg, larger avatar) */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.s,
            }}
          >
            <Avatar uri={worker.avatarUri} size="l" accessibilityLabel={worker.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {worker.name}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {worker.role}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {worker.specialization}
              </Text>
            </View>
          </View>

          {/* Mini map with location */}
          <MiniMap worker={worker} onOpenFullMap={onOpenFullMap} />

          {/* Exam history — Figma 159:14200 / 159:16070 specifies h-[176px]
              scrollable area. Vertical-only scroll, no visible scrollbar
              (class `no-scrollbar` declared in index.html hides webkit/firefox UI). */}
          <View style={{ gap: theme.gap.s }}>
            <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
              Histórico de exames
            </Text>
            <div
              className="no-scrollbar"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: theme.gap.s,
                maxHeight: 176,
                overflowY: 'auto',
                overflowX: 'hidden',
              }}
            >
              {(worker.examHistory ?? []).map((exam) => (
                <ExamInfoCard
                  key={exam.id}
                  year={exam.year}
                  date={exam.date}
                  examName={exam.title}
                  compact
                  fullWidth
                />
              ))}
            </div>
          </View>
        </View>

        {/* CENTER column — Silhouette heat avatar */}
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          <Silhouette
            gender={worker.gender === 'male' ? 'male' : 'female'}
            height={420}
            showHeart
            heatGradient
            accessibilityLabel={`Silhueta corporal de ${worker.name}`}
          />
        </View>

        {/* RIGHT column — vitals card + fatigue + stats + allergies + donuts.
            Width 459 matches Figma 159:14108 / 159:16078 spec so body stats
            stay inline and "Condições excelentes" never wraps. */}
        <View style={{ width: 459, gap: theme.gap.sm }}>
          {/* Combined vitals card — Figma 159:14109 / 159:16078. Linear gradient
              from surface.primary (green) to surface.secondary (blue). Web-only
              <div> wrapper because react-native-web View strips the
              `background` shorthand needed for linear-gradient. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: theme.gap.s,
              background: `linear-gradient(to right, ${theme.surface.primary}, ${theme.surface.secondary})`,
              borderRadius: theme.border.radius.m,
              paddingLeft: 40,
              paddingRight: theme.padding.m,
              paddingTop: theme.padding.s,
              paddingBottom: theme.padding.s,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="heart_filled" size={20} color={theme.content.light} />
                <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
                  {`${worker.bpm ?? 0} `}
                  <Text variant="body.s" color={theme.content.light}>
                    bpm
                  </Text>
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="vitals_pulse" size={20} color={theme.content.light} />
                <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
                  {worker.pressure ?? '—'}
                </Text>
              </View>
            </View>
            <Title variant="title.xs" color={theme.content.light}>
              {worker.statusLabel ?? 'Condições excelentes'}
            </Title>
          </div>

          {/* Fatigue total time — Figma 159:14118 / 159:16087. Pill-rounded
              outer container (bg=background) with padding.xs inset and an
              inset drop shadow framing a 6px gradient bar (error→warning→success).
              Outer container is a <div> because react-native-web View does
              not pass through `boxShadow: inset ...`. */}
          <View style={{ gap: theme.gap.s }}>
            <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
              Tempo até atingir fadiga total:
            </Text>
            <div
              style={{
                borderRadius: 999,
                backgroundColor: theme.background,
                paddingLeft: theme.padding.xs,
                paddingRight: theme.padding.xs,
                paddingTop: theme.padding.xs,
                paddingBottom: theme.padding.xs,
                boxShadow: 'inset 0 4px 4px 0 rgba(0,0,0,0.16)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, ((worker.fatigueMinutes ?? 0) / 240) * 100)}%`,
                  height: 6,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${theme.surface.error} 0%, ${theme.surface.warning} 45.673%, ${theme.surface.success} 100%)`,
                }}
              />
            </div>
            <Text variant="body.m" color={theme.content.dark}>
              {worker.fatigueMinutes ?? 0} minutos
            </Text>
          </View>

          {/* Divider — Figma 159:14122 / 159:16091 separates fatigue from stats. */}
          <View style={{ height: 1, backgroundColor: theme.surface.high, width: '100%' }} />

          {/* Body stats — Figma 159:14123 / 159:16092. Gênero, Idade, Tipo
              sanguíneo inline; blood type value uses body.m regular (14). */}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: theme.gap.m,
              paddingVertical: theme.padding.s,
            }}
          >
            <InlineStat label="Gênero" value={genderLabel} icon={genderIcon} />
            <InlineStat label="Idade" value={`${worker.age} anos`} />
            <InlineStat
              label="Tipo sanguíneo"
              value={worker.bloodType}
              icon="humidity_mid"
              iconColor={theme.content.error}
              valueVariant="body.m"
              valueWeight="400"
            />
          </View>

          {/* Divider — Figma 159:14135 / 159:16104 separates stats from allergies. */}
          <View style={{ height: 1, backgroundColor: theme.surface.high, width: '100%' }} />

          {/* Allergies — Figma 159:14136 / 159:16105. Title in Montserrat Bold
              16 (title.xs), then chips in surface.primary with content.light text. */}
          <View style={{ gap: theme.gap.m }}>
            <Title variant="title.xs" color={theme.content.dark}>
              Alergias
            </Title>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
              {(worker.allergies ?? []).map((a) => (
                <Chip key={a} label={a} variant="filled" />
              ))}
            </View>
          </View>

          {/* Donut charts side-by-side — Figma 159:14140 / 159:14142 (admin) and
              159:16109 / 159:16110 (employee) use the flat appearance (no
              bezel/well, thin arc). Gradients use surface tokens. */}
          <View style={{ flexDirection: 'row', gap: theme.gap.m }}>
            <View style={{ flex: 1 }}>
              <DonutChart
                title="Taxa de fadiga"
                value={`${fatiguePct}%`}
                label="Funcionários"
                progress={(worker.fatigueRate ?? 0) * 100}
                size="small"
                appearance="bevel"
                icon="heartbeat"
                progressGradient={[theme.surface.success, theme.surface.primary]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <DonutChart
                title="Esforço realizado"
                value={`${effortPct}%`}
                label="Esforço feito"
                progress={(worker.effort ?? 0) * 100}
                size="small"
                appearance="bevel"
                icon="heartbeat"
                progressGradient={[theme.surface.info, theme.surface.secondary]}
              />
            </View>
          </View>
        </View>
      </View>

      {/* BOTTOM — Caloric expenditure timeline. Figma 105:12586 / 159:16111
          places the section title + period combobox above the chart card as
          siblings, not wrapped in their own surface. The LineCaloriesChart
          already renders its own surface.medium + radius.l container. */}
      <View style={{ gap: theme.gap.m }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-start',
            alignItems: 'center',
            gap: theme.gap.s,
            // Lift the title row above the chart card sibling so the open
            // Combobox panel can float over it instead of being painted under.
            position: 'relative',
            zIndex: 10,
          }}
        >
          <Title variant="title.s" color={theme.content.dark}>
            Gasto calórico
          </Title>
          <View style={{ width: 227 }}>
            <Combobox
              options={[
                { label: 'Hoje', value: 'today' },
                { label: 'Esta semana', value: 'week' },
                { label: 'Este mês', value: 'month' },
              ]}
              value={caloriesPeriod}
              onChange={setCaloriesPeriod}
              accessibilityLabel="Período do gasto calórico"
            />
          </View>
        </View>
        <LineCaloriesChart
          points={
            CALORIES_BY_PERIOD[caloriesPeriod as keyof typeof CALORIES_BY_PERIOD] ?? CALORIES_DAY
          }
          unit="kcal"
          fullWidth
        />
      </View>
    </View>
  )
}
