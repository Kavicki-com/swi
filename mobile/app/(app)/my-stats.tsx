import { useEffect, useMemo, useState } from 'react';
import { Image as RNImage, Linking, Platform, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop, SvgXml } from 'react-native-svg';
import {
  Avatar,
  Button,
  ChipGroup,
  Combobox,
  DonutChart,
  ExamInfoCard,
  Icon,
  JourneyTheme,
  LineCaloriesChart,
  ProgressBar,
  Text,
  TimeStamp,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { useVitals } from '../../services/vitals/VitalsProvider';
import { formatEta } from '../../services/vitals/formatEta';
import { listExams, type Exam } from '../../services/api/exams';
import { examCardParts } from '../../services/api/examCard';
import { VitalsLoadingState } from '../../components/vitals/VitalsLoadingState';
import { VitalsEmptyState } from '../../components/vitals/VitalsEmptyState';
import { VitalsErrorState } from '../../components/vitals/VitalsErrorState';
import {
  HEART_STATUS_SVG,
  SILHOUETTE_BODY_SVG,
} from '../../lib/dashboardKnobSvgs';
import {
  BPM_HEART_SVG,
  FLAME_DONUT_SVG,
  FOOTPRINT_SVG,
  HEARTBEAT_BLUE_SVG,
  HEARTBEAT_GREEN_SVG,
  KCAL_FLAME_SVG,
} from '../../lib/myStatsIcons';
import { useUniqueId, useUniqueSvg } from '../../lib/uniqueSvg';
import { useProfile } from '../../services/profile/ProfileProvider';


// Divider — vertical SVG com gradient banda verde + bordas cinzas perceptíveis.
// Padronizado com a versão do dashboard.tsx: 2px largura + stops 0/0.2/0.8/1
// (banda verde sólida no miolo 60%, em vez de pico único). END=#3A3A3A
// contrasta com o background sem sumir.
const DIVIDER_GRAD_END = '#3A3A3A';
const DIVIDER_GRAD_MID = '#62BB81';

// Overlay slot for the custom donut-center icons (rendered via SvgXml on top
// Bottom-anchored icon slot that mirrors the DS DonutChart's internal icon
// row position, regardless of TitleText height variations.
//
// Why bottom-anchor and not top:43?
//   The DS Container is a flex column with [TitleText, gap.s, DonutWrapper].
//   With title="" the TitleText still renders a Text node with non-zero
//   line-height (~24pt for fontSize 16). Adding gap.s, the DonutWrapper is
//   pushed down — so an overlay at `top: 43` lands ABOVE the actual icon
//   row, leaving a visible gap between the icon and value/label below.
//
// Since DonutWrapper is the LAST child of Container (no Caption passed),
// the outer wrapper's bottom edge aligns with DonutWrapper's bottom edge.
// Using `bottom` is immune to anything stacked above.
//
// DonutChart size="small" geometry (DonutChart.styles.ts DIMS.small):
//   - DonutWrapper: 156 tall
//   - Center column: icon 28 + gap 4 + value 20 + gap 4 + label 14 ≈ 70
//   - Center is vertically centered → starts at y=(156-70)/2 = 43
//   - Icon row: y=43 to y=71 of DonutWrapper
//   - Distance from wrapper bottom to icon row bottom: 156-71 = 85
//
// The slot is a 28-tall box positioned `bottom: 85` from wrapper bottom,
// with justifyContent:center so any-sized SVG (28, 22, 19 tall) sits
// vertically centered on the same y as the DS icon row's center.
const DONUT_ICON_SLOT = {
  position: 'absolute' as const,
  bottom: 85,
  left: 0,
  right: 0,
  height: 28,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};
function Divider() {
  const gradId = useUniqueId('my-stats-divider-grad');
  return (
    <Svg width={2} height={106} viewBox="0 0 2 106">
      <Defs>
        <LinearGradient
          id={gradId}
          x1="0.5"
          y1="0"
          x2="0.5"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={DIVIDER_GRAD_END} />
          <Stop offset="0.2" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="0.8" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="1" stopColor={DIVIDER_GRAD_END} />
        </LinearGradient>
      </Defs>
      <Path d="M2 106H0V0H2V106Z" fill={`url(#${gradId})`} />
    </Svg>
  );
}

// FASE 1+2 — StatusChart + Avatar + Vital signs + ProgressBar fatigue.
// Figma 342:9419 (my-stats). Section width 328, gap.m 16.
// Calories chart points are now derived from the live vitals `history` (last 3
// caloriesPerHour samples) inside the component — Figma 342:10223 shows ~3
// well-spaced markers per period, which the 3-sample window mirrors.

const PERIOD_OPTIONS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mês', value: 'month' },
];

// Histórico médico — Figma 342:9907 (4 ExamInfoCard rows). `future`
// renderiza o year do 2033 em weight regular (não bold) per Figma
// 342:9911 — não muta cores, só sinaliza exame futuro/agendado.
// Comma-decimal percent string (pt-BR): 62.5 → "62,5%".
function pct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

// Relative "atualizado há…" label from a lastUpdated epoch (ms). NOTE: once the
// provider reaches 'stale' its context value memo is frozen, so this shows the
// elapsed time at the moment 'stale' was entered and does NOT count up. That's
// acceptable — staleness is already signalled by the dimming + this label; a
// live counter would need a local 1s tick in this screen.
function formatAgo(lastUpdated: number | null, now: number): string {
  if (lastUpdated == null) return 'atualizado agora';
  const secs = Math.max(0, Math.floor((now - lastUpdated) / 1000));
  if (secs < 60) return `atualizado há ${secs}s`;
  const mins = Math.floor(secs / 60);
  return `atualizado há ${mins}min`;
}

export default function MyStats() {
  // status is not consumed here — the my-stats heart badge is a static SVG
  // (not condition-driven), so only phase + vitals + lastUpdated + history.
  const router = useRouter();
  const { phase, vitals, lastUpdated, history } = useVitals();
  // Exames REAIS. Eram 4 inventados aqui e os MESMOS 4 duplicados no
  // settings/dados de saúde (QA 2026-07-26). Aqui é só leitura: enviar é no
  // settings, onde ficam os campos de nome e validade — um formulário só.
  const [exams, setExams] = useState<Exam[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listExams()
      .then((list) => { if (!cancelled) setExams(list); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const { profile } = useProfile();
  // Alergias REAIS do cadastro (settings/dados de saúde grava em profile.allergies,
  // texto livre). Até 2026-07-26 esta tela exibia uma lista fixa — "Buscopan,
  // Dipirona, Chocolate, Camarão" para qualquer pessoa, o que numa tela de
  // segurança do trabalho é informação clínica falsa.
  const allergyChips = (profile?.allergies ?? '')
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // SILHOUETTE_BODY_SVG tem <defs> com gradient ID — namespace por instância
  // evita colidir com a cópia que a dashboard mantém montada em background.
  const silhouetteXml = useUniqueSvg(SILHOUETTE_BODY_SVG);
  // Second silhouette instance for the multiply overlay (Figma Caminho 4123).
  const silhouetteMultiplyXml = useUniqueSvg(SILHOUETTE_BODY_SVG);
  // Donut-center icons usam gradient linear inline — também precisam namespace.
  const heartbeatGreenXml = useUniqueSvg(HEARTBEAT_GREEN_SVG);
  const heartbeatBlueXml = useUniqueSvg(HEARTBEAT_BLUE_SVG);
  const footprintXml = useUniqueSvg(FOOTPRINT_SVG);
  const flameDonutXml = useUniqueSvg(FLAME_DONUT_SVG);
  const [period, setPeriod] = useState('today');

  // T5.3: gradient arrays memoizados — antes alocavam array nova por render
  // (mudança de period quebrava memoização dos 4 DonutCharts). Theme é
  // estável, então useMemo retorna mesma ref enquanto theme não muda.
  const gradientGreen = useMemo<[string, string]>(
    () => [theme.surface.success, theme.surface.successLight],
    [theme.surface.success, theme.surface.successLight],
  );
  const gradientBlue = useMemo<[string, string]>(
    () => [theme.surface.info, theme.surface.infoLight],
    [theme.surface.info, theme.surface.infoLight],
  );
  const gradientOrange = useMemo<[string, string]>(
    () => [theme.surface.warning, theme.surface.warningLight],
    [theme.surface.warning, theme.surface.warningLight],
  );
  const gradientFlame = useMemo<[string, string, string]>(
    () => [theme.surface.error, theme.surface.warning, theme.surface.success],
    [theme.surface.error, theme.surface.warning, theme.surface.success],
  );

  // State-driven takeovers (placed AFTER all hooks to respect Rules of Hooks).
  // provider self-polls; retry is a hint — see VitalsErrorState note.
  if (phase === 'loading') return <VitalsLoadingState />;
  if (phase === 'empty') return <VitalsEmptyState />;
  if (phase === 'error') return <VitalsErrorState onRetry={() => {}} />;

  // ready | stale — vitals is non-null here (computePhase guarantees it).
  const v = vitals!;
  const isStale = phase === 'stale';
  // Calories chart points derived from the last 3 history samples (caloriesPerHour
  // over time). No per-sample timestamp is stored, so the X label is a simple
  // relative index (kept simple per spec). Falls back to the current value when
  // history is still warming up (<1 entry) so the chart never renders empty.
  const recent = history.slice(-3);
  const caloriesPoints =
    recent.length > 0
      ? recent.map((h, i) => ({ time: `-${recent.length - 1 - i}`, kcal: h.caloriesPerHour }))
      : [{ time: '0', kcal: v.caloriesPerHour }];

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    {/* Background texture overlay — Figma 342:9419 `imgMyStats`. Soft
        radial glow (faint blue top-right, faint green left) on top of the
        dark page background. pointerEvents=none on the wrapper keeps the
        decorative image from intercepting taps; setting `pointerEvents`
        on <Image> directly is deprecated in RN 0.81 (TS error TS2769).
        Explicit width/height + top:0 left:0 keeps RN-web from letting the
        image's natural 1920×1080 dimensions inflate the layout. */}
    {/* BG: gradient (my-stats-bg.png) + dot-grid (BackgroundDotsGrid layer
        in JourneyTheme, showDotGrid default true). Same pattern as dashboard
        so the dot-grid is consistent across both screens. */}
    <JourneyTheme gradient={require('../../assets/login-bg.png')} />
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 100,
        paddingHorizontal: theme.padding.m,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Top zone — Knob ("grupo taigo novo" 1069:11605) + silhouette + heart
          status, replacing the compact StatusChart. No heart-rate / settings
          sub-badge here — my-stats is already the detail screen (showActionButton
          was false on the old StatusChart). Avatar overlays in the corner. */}
      {/* Chart zone — same responsive pattern as dashboard.tsx:
          width:100% + maxWidth:360 + aspectRatio:360/374 + alignSelf:center.
          Caps at 360×374 on phones wider than the Figma reference (avoiding
          the silhouette growing disproportionally) while staying edge-to-edge
          on devices ≤360pt wide. Inner absolute children use percentages so
          they scale with the chart zone. */}
      <View
        style={{
          width: '100%',
          maxWidth: 360,
          aspectRatio: 360 / 374,
          alignSelf: 'center',
          position: 'relative',
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <RNImage
            source={require('../../assets/grupo-taigo.png')}
            resizeMode="contain"
            style={{ width: '82.78%', aspectRatio: 1 }}
            accessible={false}
          />
        </View>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: '23.39%',
            left: '39.42%',
            width: '21.38%',
            height: '70.14%',
          }}
        >
          <SvgXml xml={silhouetteXml} width="100%" height="100%" />
        </View>

        {/* Silhouette multiply overlay — Figma Caminho 4123. Stacked on top
            with mix-blend-mode: multiply for deeper/richer green. Web-only —
            em iOS/Android o overlay vira cópia opaca (wasted layer) sem
            produzir o efeito de multiply. */}
        {Platform.OS === 'web' ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '23.39%',
              left: '39.42%',
              width: '21.38%',
              height: '70.14%',
              // @ts-expect-error: mixBlendMode is web-only style (RN-web).
              mixBlendMode: 'multiply',
            }}
          >
            <SvgXml xml={silhouetteMultiplyXml} width="100%" height="100%" />
          </View>
        ) : null}

        {/* Heart status — composite SVG (heart + check badge). See dashboard
            wrapper notes for the 31.311×26.093 group geometry.
            DS bump TODO (deferred): neutral heart-status condition; using
            hide-badge fallback — when the sample is stale we hide the chest
            badge entirely rather than show a misleading 'good' check. */}
        {isStale ? null : (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: '37.25%',
              left: '47.0%',
              width: '8.7%',
              height: '6.98%',
            }}
          >
            <SvgXml xml={HEART_STATUS_SVG} width="100%" height="100%" />
          </View>
        )}
      </View>

      {/* Avatar — absolute top-right, overlays the chart (Figma 342:9422).
          Figma absolute top=34 from the frame top (não há safe-area no design).
          O Avatar fica DENTRO do ScrollView pra acompanhar o paddingTop do
          conteúdo, evitando dependência de insets.top que diverge entre
          plataformas. */}
      <View
        style={{
          position: 'absolute',
          right: 24,
          top: 34,
        }}
      >
        <Avatar customSize={64} uri={profile?.avatarUrl} name={profile?.fullName} />
      </View>

      {/* User Data column — Figma 342:9966 (gap.l 24). Width was 328 fixo,
          mudado pra full-width (esticando via paddingHorizontal do ScrollView). */}
      <View style={{ gap: theme.gap.l, marginTop: theme.gap.l }}>
        {/* Stale freshness chip — only when the latest sample aged past the
            stale window. DS TimeStamp ("atualizado há…"). */}
        {isStale ? (
          <View style={{ alignItems: 'flex-start' }}>
            <TimeStamp time={formatAgo(lastUpdated, Date.now())} />
          </View>
        ) : null}

        {/* Vital signs row — Figma 342:9431. 3 columns + dividers (1×106
            content/medium). Each column: icon 24 / value (title.l) / unit
            (caption.s).
            space-evenly: respiro igual nas paredes e entre cols (Figma);
            antes era space-between, que colava BPM/Kcal nas paredes e
            comprimia os dividers entre BPM e 12/8 no Android.
            opacity 0.5 when stale: dims the live-vitals block (see TimeStamp
            above) without altering layout. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            width: '100%',
            opacity: isStale ? 0.5 : 1,
          }}
        >
          {/* Col 1 — Heart 67 BPM (Figma 342:9432).
              width:70 (não 41 do Figma) — o simulador vai de 40 a 140 BPM,
              então 3 dígitos são esperados, e mesmo 2 já quebravam em duas
              linhas no aparelho (QA 2026-07-27). Mesma largura da coluna de
              Kcal, que segura "184", e mesmo precedente das colunas 2 e 3, que
              também subiram do valor do Figma quando o texto quebrava. */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 70,
            }}
          >
            <SvgXml
              xml={BPM_HEART_SVG}
              width={20}
              height={19}
              color={theme.content.primary}
            />
            <Title
              variant="title.l"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
              numberOfLines={1}
            >
              {v.heartRate}
            </Title>
            <Text
              variant="caption.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              BPM
            </Text>
          </View>

          <Divider />

          {/* Col 2 — Blood pressure 12/8 Boa (Figma 342:9437).
              width:80 (não 65 do Figma) — Android renderiza Montserrat-Bold
              com advance widths maiores; "12/8" estoura 65px e quebra linha. */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 80,
            }}
          >
            <Icon
              name="blood_pressure"
              size={24}
              color={theme.content.primary}
            />
            <Title
              variant="title.l"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
              numberOfLines={1}
            >
              {`${v.bloodPressureSys}/${v.bloodPressureDia}`}
            </Title>
            <Text
              variant="caption.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              Boa
            </Text>
          </View>

          <Divider />

          {/* Col 3 — Flame 145 Kcal/hora (Figma 342:9442).
              width:70 (não 55 do Figma) — "Kcal/hora" quebrava em "Kcal/" +
              "hora" no Android com 55px; mesmo padrão do dashboard.tsx. */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 70,
            }}
          >
            <SvgXml
              xml={KCAL_FLAME_SVG}
              width={17}
              height={22}
              color={theme.content.primary}
            />
            <Title
              variant="title.l"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
              numberOfLines={1}
            >
              {v.caloriesPerHour}
            </Title>
            <Text
              variant="caption.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              Kcal/hora
            </Text>
          </View>
        </View>

        {/* Fatigue ProgressBar + label — Figma 342:9446/9447.
            Bordered track 22px (content.medium border + theme.background),
            gradient RTL: success → warning → error with stops 43.75/79.253/100.
            Figma snapshot shows fill at ~74.4% (pr-76 on 328 container). */}
        <View style={{ gap: theme.gap.s, width: '100%', opacity: isStale ? 0.5 : 1 }}>
          {/* value is rounded to int — DS ProgressBar accessibilityValue.now
              é int64; floats triggam Fabric HostFunction precision error e a barra
              não renderiza. Mesmo padrão do dashboard.tsx:331. */}
          <ProgressBar
            value={Math.round(v.fatiguePct)}
            bordered
            trackHeight={22}
            gradient={[
              theme.surface.success,
              theme.surface.warning,
              theme.surface.error,
            ]}
            gradientStops={[43.75, 79.253, 100]}
            gradientDirection="rtl"
            accessibilityLabel="Tempo até fadiga total"
          />
          <Text variant="body.m" color={theme.content.dark}>
            {`Tempo até atingir fadiga total: ${formatEta(v.fatigueEtaMin)}`}
          </Text>
        </View>

        {/* Donut grid 2×2 — Figma 342:9831 (gap.m 16, w 328 = 156+16+156).
            Donut size="small" = 156. Single-tone gradients per arc.

            ANTES: o Home FAB (Figma 348:10334) era renderizado absolute
            no centro geométrico deste grid (overlap nos 16px de gap). Isso
            colocava o botão DENTRO do ScrollView → rolava com o conteúdo
            (bug reportado pelo usuário). O Home FAB agora é fixo via
            <NavFABs /> renderizado fora do ScrollView (mesmo pattern das
            outras telas do app/(app)). */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.gap.m,
            justifyContent: 'center',
            opacity: isStale ? 0.5 : 1,
          }}
        >
          {/* Donut 1 — Esforço feito (vitals.effortPct). Built-in icon hidden via
              iconColor="transparent"; Figma asset (green gradient heartbeat)
              overlay-ed at the same center slot. Same pattern in donuts 2-4. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value={pct(v.effortPct)}
              label="Esforço feito"
              progress={v.effortPct}
              progressGradient={gradientGreen}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatGreenXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 2 — Oxigenação (vitals.oxygenation). Blue gradient heartbeat asset. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value={pct(v.oxygenation)}
              label="Oxigenação"
              progress={v.oxygenation}
              progressGradient={gradientBlue}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatBlueXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 3 — Steps (vitals.steps) + distance label. Orange gradient
              footprint asset. progress kept static (no steps-goal % in Vitals). */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="footprint"
              iconColor="transparent"
              value={String(v.steps)}
              label={`${v.distanceKm.toFixed(2).replace('.', ',')}km`}
              progress={45}
              progressGradient={gradientOrange}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={footprintXml} width={20} height={22} />
            </View>
          </View>
          {/* Donut 4 — Kcal (vitals.caloriesPerHour). Multi-stop flame asset
              (red→orange→green). progress kept static (no kcal-goal % in Vitals). */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="local_fire_department"
              iconColor="transparent"
              value={`${v.caloriesPerHour} kcal`}
              label="por hora"
              progress={70}
              progressGradient={gradientFlame}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={flameDonutXml} width={17} height={19} />
            </View>
          </View>

        </View>

        {/* Divider — Figma 342:9905 */}
        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

        {/* Gasto calórico section — Figma 342:10219.
            Filter wrapper has zIndex:1 so the Combobox open-overlay (z:50
            scoped to this wrapper's stacking context) paints above the
            sibling chart container (z:0, later in DOM). Without this, the
            "Esta semana / Este mês / Este ano" options get covered by the
            chart line and labels. */}
        <View style={{ width: '100%', gap: theme.gap.m, opacity: isStale ? 0.5 : 1 }}>
          <View style={{ gap: 10, zIndex: 1 }}>
            <Title variant="title.xs" color={theme.content.dark}>
              Gasto calórico
            </Title>
            <Combobox
              options={PERIOD_OPTIONS}
              value={period}
              onChange={setPeriod}
              placeholder="Hoje"
              accessibilityLabel="Filtrar período"
            />
          </View>
          {/* LineCaloriesChart — Figma 342:10223. fullWidth + bg
              surface.medium per spec. paddingHorizontal:28 dá respiro pros
              CaloriesTag das pontas: pill min-width 55 → metade ~28pt
              overflow pra cada lado do data point. overflow:visible
              (default) é obrigatório aqui — callouts renderem em `top:
              negativo` (acima do data point). */}
          <View
            style={{
              backgroundColor: theme.surface.medium,
              borderRadius: theme.border.radius.m,
              paddingHorizontal: 28,
            }}
          >
            <LineCaloriesChart points={caloriesPoints} fullWidth />
          </View>
        </View>

        {/* Alergias section — Figma 342:9892. Title + Editar button on top
            row (justify-between); ChipGroup below. */}
        <View style={{ width: '100%', gap: theme.gap.m }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Title variant="title.xs" color={theme.content.dark}>
              Alergias
            </Title>
            <Button
              variant="outline"
              size="small"
              label="Editar alergias"
              backgroundColor={theme.surface.standard}
              borderColor={theme.content.primary}
              borderWidth="m"
              labelColor={theme.content.primary}
              onPress={() => router.push('/(app)/settings/health-data')}
            />
          </View>
          {/* Custom inline chips — DS Chip filled+secondary maps to
              surface.secondaryLight (#E2F4F8, very pale) which doesn't
              match Figma's saturated blue (#50B3D2 = surface.secondary). */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
            {allergyChips.length === 0 ? (
              <Text variant="body.s" color={theme.content.dark}>
                Nenhuma alergia informada.
              </Text>
            ) : null}
            {allergyChips.map((allergy) => (
              <View
                key={allergy}
                accessibilityRole="text"
                accessibilityLabel={allergy}
                style={{
                  backgroundColor: theme.surface.secondary,
                  paddingHorizontal: theme.padding.s,
                  paddingVertical: theme.padding.xs,
                  borderRadius: theme.border.radius.s,
                }}
              >
                <Text variant="body.s" color={theme.content.light}>
                  {allergy}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Divider — Figma 342:9906 */}
        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

        {/* Histórico Médico — Figma 342:9907. Aqui é LEITURA: os exames reais
            com download. Enviar é no settings, onde ficam os campos de nome e
            validade (sem eles o card não teria o que mostrar). gap 20 dá o
            respiro que o gap.m (16) deixava apertado vs Figma. */}
        <View style={{ width: '100%', gap: 20 }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Histórico Médico
          </Title>
          {exams.length === 0 ? (
            <Text variant="body.s" color={theme.content.dark}>
              Nenhum exame enviado.
            </Text>
          ) : null}
          {exams.map((exam) => {
            const parts = examCardParts(exam);
            return (
              <ExamInfoCard
                key={exam.id}
                year={parts.year}
                date={parts.date}
                examName={exam.name}
                compact
                fullWidth
                future={parts.future}
                onActionPress={() => Linking.openURL(exam.fileUrl)}
                accessibilityLabel={`Baixar ${exam.name}`}
              />
            );
          })}
          {/* Enviar acontece no settings, onde estão os campos de nome e
              validade — sem eles o card não teria o que mostrar. Um formulário
              só, em vez dos dois arrays duplicados de antes. */}
          <Button
            variant="outline"
            label="Enviar novo exame"
            borderColor={theme.content.primary}
            labelColor={theme.content.primary}
            accessibilityLabel="Enviar novo exame"
            onPress={() => router.push('/(app)/settings/health-data')}
          />
        </View>
      </View>
    </ScrollView>

    {/* Home FAB — fixo no rodapé (FORA do ScrollView), igual ao resto do
        app/(app). Antes ficava absolute no centro do donut grid DENTRO do
        ScrollView e rolava junto com o conteúdo. showChat=false porque a
        tela my-stats no Figma 342:9419 só tem o Home FAB. */}
    <NavFABs showChat={false} />
    </View>
  );
}
