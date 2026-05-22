import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
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
  ImageUploader,
  JourneyTheme,
  LineCaloriesChart,
  ProgressBar,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
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

const avatarUri =
  Asset.fromModule(require('../../assets/avatar-construction.png')).uri;

// Divider — vertical SVG with linear gradient (Figma `imgDivider`):
// fades #171717 → #62BB81 (midpoint) → #171717 over 106px tall, 1px wide.
// Same pattern as dashboard.tsx so vital row dividers match between screens.
const DIVIDER_GRAD_END = '#171717';
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
    <Svg width={1} height={106} viewBox="0 0 1 106">
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
          <Stop offset="0.506" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="1" stopColor={DIVIDER_GRAD_END} />
        </LinearGradient>
      </Defs>
      <Path d="M1 106H0V0H1V106Z" fill={`url(#${gradId})`} />
    </Svg>
  );
}

// FASE 1+2 — StatusChart + Avatar + Vital signs + ProgressBar fatigue.
// Figma 342:9419 (my-stats). Section width 328, gap.m 16.
// Calories points — Figma 342:10223. 3 sampled points (matches Figma layout
// which shows ~3 well-spaced markers per period filter — earlier 8-point
// list rendered cramped labels in a 328-wide container).
const CALORIES_POINTS = [
  { time: '07:15', kcal: 41 },
  { time: '08:42', kcal: 57 },
  { time: '10:51', kcal: 62 },
];

const PERIOD_OPTIONS = [
  { label: 'Hoje', value: 'today' },
  { label: 'Esta semana', value: 'week' },
  { label: 'Este mês', value: 'month' },
];

// Histórico médico — Figma 342:9907 (4 ExamInfoCard rows). `future`
// renderiza o year do 2033 em weight regular (não bold) per Figma
// 342:9911 — não muta cores, só sinaliza exame futuro/agendado.
const EXAMS: Array<{
  year: string;
  date: string;
  examName: string;
  future?: boolean;
}> = [
  { year: '2027', date: '05 Mar', examName: 'Exame de reciclagem técnica' },
  { year: '2029', date: '19 Nov', examName: 'Avaliação de segurança' },
  { year: '2031', date: '14 Jul', examName: 'Certificação em normas ISO' },
  { year: '2033', date: '28 Fev', examName: 'Exame de aptidão física e mental', future: true },
];

export default function MyStats() {
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
    <JourneyTheme gradient={require('../../assets/my-stats-bg.png')} />
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
            with mix-blend-mode: multiply for deeper/richer green. Same pos
            and size as base layer. */}
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

        {/* Heart status — composite SVG (heart + check badge). See dashboard
            wrapper notes for the 31.311×26.093 group geometry. */}
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
        <Avatar customSize={64} uri={avatarUri} />
      </View>

      {/* User Data column — Figma 342:9966 (gap.l 24). Width was 328 fixo,
          mudado pra full-width (esticando via paddingHorizontal do ScrollView). */}
      <View style={{ gap: theme.gap.l, marginTop: theme.gap.l }}>
        {/* Vital signs row — Figma 342:9431. 3 columns + dividers (1×106
            content/medium). Each column: icon 24 / value (title.l) / unit
            (caption.s). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          {/* Col 1 — Heart 67 BPM (Figma 342:9432) */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 41,
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
            >
              67
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

          {/* Col 2 — Blood pressure 12/8 Boa (Figma 342:9437) */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 65,
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
            >
              12/8
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

          {/* Col 3 — Flame 145 Kcal/hora (Figma 342:9442) */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 55,
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
            >
              145
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
        <View style={{ gap: theme.gap.s, width: '100%' }}>
          {/* value=74 (int) not 74.4 (float) — DS ProgressBar accessibilityValue.now
              é int64; floats triggam Fabric HostFunction precision error e a barra
              não renderiza. Mesmo padrão do dashboard.tsx:331. */}
          <ProgressBar
            value={74}
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
            Tempo até atingir fadiga total: 1h45m
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
          }}
        >
          {/* Donut 1 — Esforço feito 62,5%. Built-in icon hidden via
              iconColor="transparent"; Figma asset (green gradient heartbeat)
              overlay-ed at the same center slot. Same pattern in donuts 2-4. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value="62,5%"
              label="Esforço feito"
              progress={62.5}
              progressGradient={[theme.surface.success, theme.surface.successLight]}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatGreenXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 2 — Oxigenação 92,2%. Blue gradient heartbeat asset. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="heartbeat"
              iconColor="transparent"
              value="92,2%"
              label="Oxigenação"
              progress={92.2}
              progressGradient={[theme.surface.info, theme.surface.infoLight]}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={heartbeatBlueXml} width={35} height={28} />
            </View>
          </View>
          {/* Donut 3 — Steps 8975 4,32km. Orange gradient footprint asset. */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="footprint"
              iconColor="transparent"
              value="8975"
              label="4,32km"
              progress={45}
              progressGradient={[theme.surface.warning, theme.surface.warningLight]}
            />
            <View pointerEvents="none" style={DONUT_ICON_SLOT}>
              <SvgXml xml={footprintXml} width={20} height={22} />
            </View>
          </View>
          {/* Donut 4 — Kcal 125. Multi-stop flame asset (red→orange→green). */}
          <View style={{ position: 'relative' }}>
            <DonutChart
              size="small"
              appearance="bevel"
              title=""
              icon="local_fire_department"
              iconColor="transparent"
              value="125 kcal"
              label="por hora"
              progress={70}
              progressGradient={[
                theme.surface.error,
                theme.surface.warning,
                theme.surface.success,
              ]}
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
        <View style={{ width: '100%', gap: theme.gap.m }}>
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
            <LineCaloriesChart points={CALORIES_POINTS} fullWidth />
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
              onPress={() => {
                /* TODO: open edit-alergias sheet */
              }}
            />
          </View>
          {/* Custom inline chips — DS Chip filled+secondary maps to
              surface.secondaryLight (#E2F4F8, very pale) which doesn't
              match Figma's saturated blue (#50B3D2 = surface.secondary). */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.gap.s }}>
            {['Buscopan', 'Dipirona', 'Chocolate', 'Camarão'].map((allergy) => (
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

        {/* Histórico Médico — Figma 342:9907 (4 ExamInfoCard + ImageUploader).
            gap.m (16) entre Title→first-card e cards entre si é um pouco
            compacto vs Figma (~20px); subindo pra 20 dá respiro extra. */}
        <View style={{ width: '100%', gap: 20 }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Histórico Médico
          </Title>
          {EXAMS.map((exam) => (
            <ExamInfoCard
              key={`${exam.year}-${exam.date}`}
              year={exam.year}
              date={exam.date}
              examName={exam.examName}
              compact
              fullWidth
              future={exam.future}
              onActionPress={() => {
                /* TODO: trigger download */
              }}
              accessibilityLabel={`Baixar ${exam.examName}`}
            />
          ))}
          <ImageUploader
            helperText="Selecione arquivos do tipo: JPG ou PNG"
            pickFileLabel="Enviar novo exame"
            showTakePhoto={false}
            accentColor={theme.content.primary}
            onPickFile={() => {
              /* TODO: open file picker */
            }}
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
