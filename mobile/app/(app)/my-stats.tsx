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
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { useWatchDiagnostics } from '../../services/telemetry/watchDiagnostics';
import { useMyTelemetry } from '../../services/vitals/MyTelemetryProvider';
import { useMySeries } from '../../services/vitals/useMySeries';
import { dashboardVitalsView, NO_VALUE } from '../../services/vitals/dashboardVitalsView';
import { caloriesChartView, statsDonutsView } from '../../services/vitals/statsView';
import type { SeriesPeriod } from '../../services/telemetry/mySeries';
import type { WorkerStatus } from '../../services/vitals/types';
import { listExams, type Exam } from '../../services/api/exams';
import { abrirMidiaOuAvisar } from '../../lib/media/trustedMediaUrl';
import { examCardParts } from '../../services/api/examCard';
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

// O valor de cada opção é o período que a rota de série do backend aceita
// (me/series?period=): o gráfico de gasto calórico relê a série a cada troca.
const PERIOD_OPTIONS: { label: string; value: SeriesPeriod }[] = [
  { label: 'Hoje', value: 'day' },
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mês', value: 'month' },
];

// Mesmas conversoes do dashboard: sem leitura a silhueta fica neutra e o badge
// some. Nem cor nem check podem afirmar um estado que ninguem mediu.
function toChartCondition(status: WorkerStatus): 'good' | 'alert' | 'low' | 'neutral' {
  return status === 'unknown' ? 'neutral' : status;
}

function toHeartCondition(status: WorkerStatus): 'check' | 'alert' | 'low' | null {
  if (status === 'good') return 'check';
  if (status === 'alert') return 'alert';
  if (status === 'low') return 'low';
  return null;
}

export default function MyStats() {
  const router = useRouter();
  // Sinais de me/current e gasto calórico de me/series. Carregando, sem leitura
  // e falha não trocam a tela: as visões devolvem a ausência declarada, e
  // alergias e exames (dado real do cadastro) seguem à vista.
  const { telemetry, failed, loading } = useMyTelemetry();
  // Sem o módulo do relógio a linha de estado diz onde o monitoramento
  // funciona, no mesmo Text, para a tela ficar igual à do iPhone.
  const unsupported = useWatchDiagnostics().support === 'unsupported';
  const view = dashboardVitalsView(telemetry, { failed, loading, unsupported });
  const donuts = statsDonutsView(telemetry);
  const status = view.workerStatus;
  const [period, setPeriod] = useState<SeriesPeriod>('day');
  const seriesState = useMySeries(period);
  const chart = caloriesChartView(seriesState.series, seriesState);
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-evenly',
            width: '100%',
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
              {view.heartRate ?? NO_VALUE}
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
              {view.pressure ?? NO_VALUE}
            </Title>
            <Text
              variant="caption.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              {view.pressureLabel}
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
              {view.energyRate ?? NO_VALUE}
            </Title>
            <Text
              variant="caption.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              {view.energyLabel}
            </Text>
          </View>
        </View>

        <View style={{ gap: theme.gap.s, width: '100%' }}>
          {/* O valor chega inteiro da visão: o accessibilityValue.now do
              ProgressBar do DS é int64, e float dispara erro de precisão no
              Fabric e a barra não renderiza. Sem avaliação de desgaste a barra
              fica vazia e o texto diz que não há estimativa. */}
          <ProgressBar
            value={view.fatigueProgress ?? 0}
            bordered
            trackHeight={22}
            gradient={[
              theme.surface.success,
              theme.surface.warning,
              theme.surface.error,
            ]}
            gradientStops={[43.75, 79.253, 100]}
            gradientDirection="rtl"
            accessibilityLabel="Tempo até o alerta de fadiga"
          />
          <Text variant="body.m" color={theme.content.dark}>
            {view.fatigueText}
          </Text>
          {/* Em que pé está a leitura e, quando não vem do relógio real, o
              selo de origem. Mesma linha do dashboard. */}
          <Text variant="caption.s" color={theme.content.dark}>
            {view.sourceBadge ? `${view.status} · ${view.sourceBadge}` : view.status}
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.gap.m,
            justifyContent: 'center',
          }}
        >
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value={donuts.effort.value}
              label={donuts.effort.label}
              progress={donuts.effort.progress}
              progressGradient={gradientGreen}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatGreenXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 2: Oxigenação (medição pontual de me/current; o horário da
              última vai na nota abaixo dos anéis). Blue gradient heartbeat asset. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value={donuts.oxygen.value}
              label={donuts.oxygen.label}
              progress={donuts.oxygen.progress}
              progressGradient={gradientBlue}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatBlueXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 3: Passos + distância do dia no rótulo. Orange gradient
              footprint asset. Não há meta de passos: o arco fica cheio com
              leitura e vazio sem ela, sem sugerir fração de meta nenhuma. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="footprint"
              iconColor="transparent"
              value={donuts.steps.value}
              label={donuts.steps.label}
              progress={donuts.steps.progress}
              progressGradient={gradientOrange}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={footprintXml} width={20} height={22} />
            </View>
          </View>
          {/* Donut 4: Gasto por hora. Multi-stop flame asset
              (red→orange→green). Sem meta de calorias: arco cheio com leitura,
              vazio sem ela, como o de passos. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="local_fire_department"
              iconColor="transparent"
              value={donuts.energy.value}
              label={donuts.energy.label}
              progress={donuts.energy.progress}
              progressGradient={gradientFlame}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={flameDonutXml} width={17} height={19} />
            </View>
          </View>

        </View>

        {/* Linhas de Text do DS para o que o Figma não desenhou: de quando é a
            oxigenação (medição pontual) e a bateria do aparelho. */}
        <View style={{ gap: theme.gap.s, width: '100%' }}>
          {donuts.oxygenNote ? (
            <Text variant="body.s" color={theme.content.dark}>
              {donuts.oxygenNote}
            </Text>
          ) : null}
          <Text variant="body.s" color={theme.content.dark}>
            {donuts.battery}
          </Text>
        </View>

        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

        <View style={{ width: '100%', gap: theme.gap.m }}>
          <View style={{ gap: 10, zIndex: 1 }}>
            <Title variant="title.xs" color={theme.content.dark}>
              Gasto calórico
            </Title>
            <Combobox
              options={PERIOD_OPTIONS}
              value={period}
              onChange={(value) =>
                setPeriod(PERIOD_OPTIONS.find((o) => o.value === value)?.value ?? 'day')
              }
              placeholder="Hoje"
              accessibilityLabel="Filtrar período"
            />
          </View>
          {chart.sourceBadge ? (
            <Text variant="caption.s" color={theme.content.dark}>
              {chart.sourceBadge}
            </Text>
          ) : null}
          {/* Sem série para desenhar (carregando, falha ou período sem
              medição) entra a frase no lugar do gráfico, nunca um ponto. */}
          {chart.emptyText ? (
            <Text variant="body.s" color={theme.content.dark}>
              {chart.emptyText}
            </Text>
          ) : (
            <View
              style={{
                backgroundColor: theme.surface.medium,
                borderRadius: theme.border.radius.m,
                paddingHorizontal: 28,
              }}
            >
              <LineCaloriesChart points={chart.points} unit={chart.unit} fullWidth />
            </View>
          )}
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
