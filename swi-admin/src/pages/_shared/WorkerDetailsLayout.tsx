// src/pages/_shared/WorkerDetailsLayout.tsx
// Shared 3-column worker details layout, used by AdminDetails and
// EmployeeDetails. Pure presentational: takes a `worker`
// payload + a `topRightAction` slot for the page-specific CTA. The page owns
// data fetching, loading/empty states, and back/CTA navigation.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import type * as maplibregl from 'maplibre-gl'
import { useMapLibre } from '@/lib/useMapLibre'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useDemoToast } from '@/lib/demoToast'
import { DataOriginBadge } from '@/components/DataOriginBadge'
import { formatAge } from '@/lib/formatAge'
import type { Gender } from '@/services/types/directory'
import { PERIOD_FROM_OPTION } from '@/services/vitals/caloriesSeries'
import { useWorkerSeries } from '@/hooks/useWorkerSeries'
import { NO_VALUE, type WorkerVitalsView } from '@/services/vitals/vitalsView'
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
  /** URL presignada do arquivo. Ausente nas entradas de demo do roster. */
  fileUrl?: string
}

export type WorkerDetailsData = {
  name: string
  // Handle visível (@username). Ausente em conta que não definiu um.
  username?: string
  age: number
  bloodType: string
  role: string
  specialization: string
  avatarUri: string
  gender?: Gender
  /**
   * Vitais já decididos a partir da leitura do aparelho (vitalsViewFrom).
   * Obrigatório de propósito: sem ele a tela voltaria a preencher com zero.
   */
  vitals: WorkerVitalsView
  allergies?: ReadonlyArray<string>
  examHistory?: ReadonlyArray<WorkerExamEntry>
  /**
   * Funcionário cuja série de gasto calórico o gráfico lê. Ausente para quem
   * não pareia aparelho (administrador): o gráfico diz "Sem aparelho".
   */
  seriesWorkerId?: string
}

export type WorkerDetailsLayoutProps = {
  worker: WorkerDetailsData
  /**
   * Posição AO VIVO da pessoa, pro mini-mapa. Quando vem nula o mini-mapa
   * declara "Sem posição ao vivo" em vez de pinar numa coordenada default.
   */
  position?: { lat: number; lng: number } | null
  /**
   * Hora da posição quando ela está velha ("Última posição às 14:32"), junto
   * do mini-mapa; o pino não muda. Ausente com posição atual.
   */
  positionNote?: string | null
  testID: string
  onBack: () => void
  backA11yLabel: string
  onOpenFullMap: () => void
  topRightAction: ReactNode
  /**
   * Bloco "Aparelho" (pareamento do iPhone do piloto). Só o detalhe de
   * funcionário passa este slot; administrador não tem aparelho, e o layout
   * não decide isso sozinho.
   */
  deviceSection?: ReactNode
}

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
  position,
  onOpenFullMap,
}: {
  worker: WorkerDetailsData
  position?: { lat: number; lng: number } | null
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  const lib = useMapLibre()
  const { show: showToast } = useDemoToast()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const avatarRef = useRef<HTMLDivElement | null>(null)
  const lngLat: [number, number] | null = position ? [position.lng, position.lat] : null
  useEffect(() => {
    if (!lib || !containerRef.current || !lngLat || mapRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center: lngLat,
      // 13 enquadrava a cidade inteira: pra "onde ele está agora" o útil é o
      // entorno imediato.
      zoom: 16,
      interactive: false,
      attributionControl: false,
    })
    mapRef.current = map
    // Marker DOM: LocationPin = circular avatar (with
    // blue ring) + small triangular tail pointing down (anchors at the
    // tip of the tail on the map lat/lng).
    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'
    wrapper.style.alignItems = 'center'

    const avatarEl = document.createElement('div')
    avatarRef.current = avatarEl
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

    const marker = new lib.Marker({ element: wrapper, anchor: 'bottom' })
    markerRef.current = marker.setLngLat(lngLat).addTo(map)
    // Nasce uma vez por página: `worker` chega novo a cada render, e posição e
    // foto seguem pelos efeitos abaixo. O tema é fixo (modo escuro) e fica de fora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, lngLat === null])
  // Posição nova move o pino e recentraliza, sem recriar o mapa.
  useEffect(() => {
    if (!lngLat) return
    markerRef.current?.setLngLat(lngLat)
    mapRef.current?.setCenter(lngLat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lngLat?.[0], lngLat?.[1]])
  useEffect(() => {
    if (avatarRef.current) avatarRef.current.style.backgroundImage = `url("${worker.avatarUri}")`
  }, [worker.avatarUri])
  // Sem posição o mapa segue vivo sob o aviso; só sai junto com a página.
  useEffect(() => {
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])
  return (
    <View
      style={{
        height: 132,
        // Cap the map at the 1366px reference width (LEFT col = 380). When the LEFT
        // column grows at wide (>=1500), the satellite tiles would stretch to
        // ~5:1 aspect ratio, capping keeps the map at its specified aspect (2.88:1)
        // and the other LEFT-col content (profile, exam history) absorbs the
        // extra width.
        maxWidth: 380,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {!lngLat ? (
        <View
          style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.surface.medium,
          }}
        >
          <Text variant="body.s" color={theme.content.medium}>
            Sem posição ao vivo
          </Text>
        </View>
      ) : null}
      <View style={{ position: 'absolute', left: 8, bottom: 8 }}>
        <Button
          label="Mapa completo"
          variant="contained"
          size="small"
          onPress={onOpenFullMap}
          accessibilityLabel="Ver mapa completo"
        />
      </View>
      {/* Camera affordance: ContainedButton
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
// Right-column stats: label always body.m bold
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
  position,
  positionNote,
  testID,
  onBack,
  backA11yLabel,
  onOpenFullMap,
  topRightAction,
  deviceSection,
}: WorkerDetailsLayoutProps) {
  const theme = useTheme()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const isWide = breakpoint === 'wide'
  // Sem gênero no cadastro NÃO se inventa um: o campo ausente cai em
  // "Não informado", nunca num dos dois valores reais.
  const genderLabel =
    worker.gender === 'male'
      ? 'Masculino'
      : worker.gender === 'female'
        ? 'Feminino'
        : worker.gender === 'other'
          ? 'Outro'
          : 'Não informado'
  // O glifo neutro cobre 'other' e a ausência. Antes o `else` caía no ícone
  // masculino, então "Não informado" aparecia ao lado do desenho de um homem,
  // que é exatamente o gênero que o rótulo se recusa a afirmar.
  const genderIcon: IconName =
    worker.gender === 'female'
      ? 'humidity_mid'
      : worker.gender === 'male'
        ? 'admin_filled'
        : 'account_circle'
  const { vitals } = worker
  // Desgaste e esforço já chegam na escala 0-100, não em fração 0-1. formatPct
  // só formata: multiplicar por 100 aqui exibiria "8.900,0%". Sem leitura, a
  // rosca mostra NO_VALUE e fica vazia em vez de afirmar 0%.
  const formatPct = (n: number | null) =>
    n === null
      ? NO_VALUE
      : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`
  const fatiguePct = formatPct(vitals.wearPct)
  const effortPct = formatPct(vitals.effortPct)
  const allergies = worker.allergies ?? []
  const exams = worker.examHistory ?? []
  const [caloriesPeriod, setCaloriesPeriod] = useState<keyof typeof PERIOD_FROM_OPTION>('today')
  const calories = useWorkerSeries(worker.seriesWorkerId, PERIOD_FROM_OPTION[caloriesPeriod])
  // Estado do gráfico quando não há curva a desenhar: a frase diz o porquê.
  const caloriesEmpty = calories.noDevice
    ? 'Sem aparelho'
    : calories.loading
      ? 'Carregando…'
      : calories.failed
        ? 'Gasto calórico indisponível no momento'
        : calories.points.length === 0
          ? 'Sem medição neste período'
          : null

  return (
    <View testID={testID} style={{ gap: theme.gap.m }}>
      {/* Top bar — Voltar (left, ghost text + chevron) + page-specific CTA
          (right, supplied via topRightAction slot). The right CTA differs per
          page: AdminDetails uses an "Editar perfil"
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

      {/* Three-column body — at tablet (<1024) stacks into a single column
          (LEFT → CENTER → RIGHT) so the 380+silhouette+459 layout fits below
          the collapsed sidebar. Desktop (1024-1499) and wide (>=1500) keep
          the 380 / flex / 459 spec. */}
      <View
        style={{
          flexDirection: isTablet ? 'column' : 'row',
          alignItems: isTablet ? 'stretch' : 'flex-start',
          gap: theme.gap.m,
        }}
      >
        {/* LEFT column — profile + mini map + exam history.
            - Tablet (<1024): full-width (stacked).
            - Desktop (1024-1499): hard width 380 to match the specified layout
              exactly. CENTER absorbs the slack at this width.
            - Wide (>=1500): flexBasis 380 + flexGrow 1 so the column grows to
              fill the screen alongside RIGHT (boss directive). CENTER stays
              fixed at 170 in the wide branch (below). */}
        <View
          style={{
            ...(isTablet
              ? null
              : isWide
                ? ({ flexBasis: 380, flexGrow: 1, flexShrink: 0 } as const)
                : { width: 380 }),
            gap: theme.gap.s,
          }}
        >
          {/* Profile: the design shows the avatar proportionally
              larger than DS size="l" (64). customSize=80 matches the specified
              80px diameter circle. Vertical centering (alignItems: 'center')
              keeps the 3-line text block visually balanced against the taller
              avatar. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.s,
            }}
          >
            <Avatar uri={worker.avatarUri} customSize={80} accessibilityLabel={worker.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {worker.name}
              </Text>
              {/* Handle sob o nome, apenas quando a conta tem um: @ vazio ou
                  inventado afirmaria identidade que não existe. */}
              {worker.username ? (
                <Text variant="body.m" color={theme.content.medium}>
                  {`@${worker.username}`}
                </Text>
              ) : null}
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {worker.role}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {worker.specialization}
              </Text>
            </View>
          </View>

          {/* Mini map with location */}
          <MiniMap worker={worker} position={position} onOpenFullMap={onOpenFullMap} />
          {positionNote ? (
            <Text variant="body.s" color={theme.content.medium}>
              {positionNote}
            </Text>
          ) : null}

          {deviceSection}

          {/* Exam history: h-[176px] scrollable area. Vertical-only scroll, no visible scrollbar
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
              {exams.length > 0 ? (
                exams.map((exam) => (
                  <ExamInfoCard
                    key={exam.id}
                    year={exam.year}
                    date={exam.date}
                    examName={exam.title}
                    compact
                    fullWidth
                    // Entrada de demo não tem arquivo: desabilita em vez de
                    // deixar um botão de download que não baixa nada.
                    actionDisabled={!exam.fileUrl}
                    onActionPress={
                      exam.fileUrl
                        ? () => window.open(exam.fileUrl, '_blank', 'noopener,noreferrer')
                        : undefined
                    }
                  />
                ))
              ) : (
                // Um título sozinho lê como "falha de carregamento". Dizer que
                // não há exames é informação; o vazio mudo não é.
                <Text variant="body.s" color={theme.content.medium}>
                  Nenhum exame registrado.
                </Text>
              )}
            </div>
          </View>
        </View>

        {/* CENTER column — Silhouette heat avatar.
            - Tablet: drops fixed width so Silhouette sizes intrinsically and
              centres horizontally in the stacked layout.
            - Desktop (1024-1499): flex:1 absorbs the slack between LEFT 380 and
              RIGHT 459 — gives the silhouette the same ~107px wide column the
              1366px reference frame produces, preserving fidelity.
            - Wide (>=1500): fixed 170 px so the silhouette doesn't blow up;
              LEFT and RIGHT absorb the extra wide-viewport space instead. */}
        <View
          style={{
            ...(isTablet
              ? null
              : isWide
                ? ({ width: 170, flexGrow: 0, flexShrink: 0 } as const)
                : { flex: 1 }),
            alignItems: 'center',
            justifyContent: 'flex-start',
          }}
        >
          {/* Per product directive: silhouette is always the masculino variant
             regardless of worker.gender — the female SVG was deprecated. */}
          <Silhouette
            gender="male"
            height={420}
            showHeart
            heatGradient
            accessibilityLabel={`Silhueta corporal de ${worker.name}`}
          />
        </View>

        {/* RIGHT column — vitals card + fatigue + stats + allergies + donuts.
            - Tablet: full-width (stacked).
            - Desktop (1024-1499): hard width 459
              so body stats stay inline and "Condições excelentes" never wraps.
            - Wide (>=1500): flexBasis 459 + flexGrow 1 — grows together with
              LEFT to fill the screen (boss directive). */}
        <View
          style={{
            ...(isTablet
              ? null
              : isWide
                ? ({ flexBasis: 459, flexGrow: 1, flexShrink: 0 } as const)
                : { width: 459 }),
            gap: theme.gap.sm,
          }}
        >
          {/* Combined vitals card. Linear gradient
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
                  {`${vitals.heartRate ?? NO_VALUE} `}
                  <Text variant="body.s" color={theme.content.light}>
                    bpm
                  </Text>
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="vitals_pulse" size={20} color={theme.content.light} />
                <Text variant="body.s" color={theme.content.light} style={{ fontWeight: '700' }}>
                  {vitals.pressure ?? NO_VALUE}
                </Text>
              </View>
            </View>
            {/* Estado da LEITURA, não da saúde: juízo de saúde só com as
                condições do backend. */}
            <Title variant="title.xs" color={theme.content.light}>
              {vitals.status}
            </Title>
          </div>

          {/* Leitura de demonstração é declarada; leitura real do relógio
              dispensa selo. */}
          {vitals.sourceBadge ? (
            <View style={{ alignItems: 'flex-end' }}>
              <DataOriginBadge label={vitals.sourceBadge} testID="vitals-source-badge" />
            </View>
          ) : null}

          {/* Fatigue total time. Pill-rounded
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
                  width: `${Math.min(100, ((vitals.fatigueEta.minutes ?? 0) / 240) * 100)}%`,
                  height: 6,
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${theme.surface.error} 0%, ${theme.surface.warning} 45.673%, ${theme.surface.success} 100%)`,
                }}
              />
            </div>
            <Text variant="body.m" color={theme.content.dark}>
              {vitals.fatigueEta.label}
            </Text>
          </View>

          {/* Divider separates fatigue from stats. */}
          <View style={{ height: 1, backgroundColor: theme.surface.high, width: '100%' }} />

          {/* Body stats. Gênero, Idade, Tipo
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
            <InlineStat label="Idade" value={formatAge(worker.age)} />
            <InlineStat
              label="Tipo sanguíneo"
              value={worker.bloodType}
              icon="humidity_mid"
              iconColor={theme.content.error}
              valueVariant="body.m"
              valueWeight="400"
            />
          </View>

          {/* Divider separates stats from allergies. */}
          <View style={{ height: 1, backgroundColor: theme.surface.high, width: '100%' }} />

          {/* Allergies. Title in Montserrat Bold
              16 (title.xs), then chips in surface.primary with content.light text. */}
          <View style={{ gap: theme.gap.m }}>
            <Title variant="title.xs" color={theme.content.dark}>
              Alergias
            </Title>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
              {allergies.length > 0 ? (
                allergies.map((a) => <Chip key={a} label={a} variant="filled" />)
              ) : (
                // "Nenhuma alergia registrada" ≠ "nenhuma alergia": o campo é
                // declaratório e pode simplesmente não ter sido preenchido.
                <Text variant="body.s" color={theme.content.medium}>
                  Nenhuma alergia registrada.
                </Text>
              )}
            </View>
          </View>

          {/* Donut charts side-by-side: both admin and employee use the flat
              appearance (no bezel/well, thin arc). Gradients use surface tokens.
              Each chart sizes intrinsically via size="small"; the row aligns
              them to the LEFT of the column so they line up with the vitals,
              fatigue and allergies stack above (column-edge alignment). */}
          {/* Each donut sits at intrinsic size (size="small" → 156 wide).
              The row is at the LEFT of the right column, so the first donut
              card's left edge aligns with "Alergias"/"Tempo até atingir fadiga"
              above. Title stays CENTERED above its own chart per DS default. */}
          <View style={{ flexDirection: 'row', gap: theme.gap.m, alignItems: 'flex-start' }}>
            <DonutChart
              title="Taxa de fadiga"
              value={fatiguePct}
              // O donut mede UMA pessoa, então a legenda fala do estado dela e
              // não de um KPI de equipe.
              label="Fadiga atual"
              progress={vitals.wearPct ?? 0}
              size="small"
              appearance="bevel"
              icon="heartbeat"
              progressGradient={[theme.surface.success, theme.surface.primary]}
            />
            <DonutChart
              title="Esforço realizado"
              value={effortPct}
              label="Esforço feito"
              progress={vitals.effortPct ?? 0}
              size="small"
              appearance="bevel"
              icon="heartbeat"
              progressGradient={[theme.surface.info, theme.surface.secondary]}
            />
          </View>
        </View>
      </View>

      {/* BOTTOM: Caloric expenditure timeline. The section title + period
          combobox sit above the chart card as
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
              onChange={(value) => {
                if (value in PERIOD_FROM_OPTION)
                  setCaloriesPeriod(value as keyof typeof PERIOD_FROM_OPTION)
              }}
              accessibilityLabel="Período do gasto calórico"
            />
          </View>
        </View>
        {/* A curva sai da série do backend. Balde sem medição fica fora da
            curva, e período sem nenhuma medição vira frase, nunca zeros. */}
        {caloriesEmpty === null ? (
          <View testID="calories-chart">
            <LineCaloriesChart points={calories.points} unit="kcal" fullWidth />
          </View>
        ) : (
          <View
            testID="calories-empty"
            style={{
              backgroundColor: theme.surface.medium,
              borderRadius: theme.border.radius.l,
              padding: theme.padding.m,
              alignItems: 'center',
            }}
          >
            <Text variant="body.m" color={theme.content.medium}>
              {caloriesEmpty}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}
