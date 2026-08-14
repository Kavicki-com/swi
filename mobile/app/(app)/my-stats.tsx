import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Stop, SvgXml } from 'react-native-svg';
import {
  Avatar,
  Button,
  Combobox,
  DonutChart,
  ExamInfoCard,
  Icon,
  JourneyTheme,
  LineCaloriesChart,
  ProgressBar,
  StatusChart,
  Text,
  TimeStamp,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { useVitals } from '../../services/vitals/VitalsProvider';
import type { WorkerStatus } from '../../services/vitals/types';
import { formatEta } from '../../services/vitals/formatEta';
import { listExams, type Exam } from '../../services/api/exams';
import { abrirMidiaOuAvisar } from '../../lib/media/trustedMediaUrl';
import { examCardParts } from '../../services/api/examCard';
import { VitalsLoadingState } from '../../components/vitals/VitalsLoadingState';
import { VitalsEmptyState } from '../../components/vitals/VitalsEmptyState';
import { VitalsErrorState } from '../../components/vitals/VitalsErrorState';
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

// Calories chart points are now derived from the live vitals `history` (last 3
// well-spaced markers per period, which the 3-sample window mirrors.

const PERIOD_OPTIONS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mês', value: 'month' },
];

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

// Mesmas conversoes do dashboard: 'unknown' cai em 'good' pro grafico (que
// precisa de UMA cor), mas devolve null pro badge — sem dado, o peito fica
// vazio em vez de exibir um check que ninguem mediu.
function toChartCondition(status: WorkerStatus): 'good' | 'alert' | 'low' {
  return status === 'alert' || status === 'low' ? status : 'good';
}

function toHeartCondition(status: WorkerStatus): 'check' | 'alert' | 'low' | null {
  if (status === 'good') return 'check';
  if (status === 'alert') return 'alert';
  if (status === 'low') return 'low';
  return null;
}

export default function MyStats() {
  const router = useRouter();
  const { phase, vitals, status, lastUpdated, history } = useVitals();
  // Exames REAIS. Eram 4 inventados aqui e os MESMOS 4 duplicados no
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
  // Dipirona, Chocolate, Camarão" para qualquer pessoa, o que numa tela de
  // segurança do trabalho é informação clínica falsa.
  const allergyChips = (profile?.allergies ?? '')
    .split(/[,;\n]/)
    .map((a) => a.trim())
    .filter(Boolean);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const heartCondition = toHeartCondition(status);
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
  // Duas paradas, não três: o DonutArc da DS desestrutura `[arcFrom, arcTo]` e
  // descarta o resto desde que trocou o gradiente por dois preenchimentos
  // chapados. A terceira cor que ficava aqui nunca chegou a pintar nada.
  const gradientFlame = useMemo<[string, string]>(
    () => [theme.surface.error, theme.surface.warning],
    [theme.surface.error, theme.surface.warning],
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
    {/* BG: gradient (my-stats-bg.png) + dot-grid (BackgroundDotsGrid layer
        in JourneyTheme, showDotGrid default true). Same pattern as dashboard
        so the dot-grid is consistent across both screens. */}
    <JourneyTheme gradient={require('../../assets/login-bg.png')} showDotGrid={false} />
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
      <View
        style={{
          width: '100%',
          maxWidth: 360,
          alignSelf: 'center',
          position: 'relative',
        }}
      >
      <View style={{ alignSelf: 'center' }}>
        <StatusChart
          condition={toChartCondition(status)}
          progress={1}
          // compact espelha o nó 342:9420: ele esconde só o Caminho 4122, o
          // heart-rate-button e o cartão do container. Bezel, pontos, trilho,
          // Ellipse 5 e poço seguem visíveis — sao eles que dao profundidade
          // ao botao. (A v0.1.126 escondia sete camadas por leitura errada
          size="compact"
          showActionButton={false}
          // O badge volta a ser posicionado pelo DS: fazer isso à mão exigia
          // converter HEART_STATUS_OFFSET pra percentuais do canvas, e no
          // preset compact a conta muda — o coração saiu do peito, deslocado
          //
          // Sem status conhecido o badge some por inteiro, em vez de exibir um
          // check verde que ninguém mediu. É o mesmo princípio do resto da
          // tela: só mostrar o que foi medido.
          renderHeartStatus={heartCondition !== null}
          accessibilityLabel="Status de saude"
        />
      </View>

      <View style={{ position: 'absolute', right: 24, top: 34 }}>
        <Avatar
          customSize={64}
          bordered
          borderWidth={4}
          borderColor={theme.content.light}
          uri={profile?.avatarUrl}
          name={profile?.fullName}
          fallbackBackgroundColor={theme.surface.medium}
        />
      </View>
      </View>

      <View style={{ gap: theme.gap.l, marginTop: theme.gap.l }}>
        {/* Stale freshness chip — only when the latest sample aged past the
            stale window. DS TimeStamp ("atualizado há…"). */}
        {isStale ? (
          <View style={{ alignItems: 'flex-start' }}>
            <TimeStamp time={formatAgo(lastUpdated, Date.now())} />
          </View>
        ) : null}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            width: '100%',
            opacity: isStale ? 0.5 : 1,
          }}
        >
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

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.gap.m,
            justifyContent: 'center',
            opacity: isStale ? 0.5 : 1,
          }}
        >
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

        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

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

        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

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
                onActionPress={() => { void abrirMidiaOuAvisar(exam.fileUrl, exam.name); }}
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

    <NavFABs showChat={false} />
    </View>
  );
}
