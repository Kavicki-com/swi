import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  ChipGroup,
  Combobox,
  DonutChart,
  ExamInfoCard,
  Icon,
  ImageUploader,
  LineCaloriesChart,
  ProgressBar,
  StatusChart,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

const avatarUri =
  Asset.fromModule(require('../../assets/avatar-construction.png')).uri;

// FASE 1+2 — StatusChart + Avatar + Vital signs + ProgressBar fatigue.
// Figma 342:9419 (my-stats). Section width 328, gap.m 16.
// Calories points — Figma 342:10223. 10 sampled points (kcal labels match
// the timestamps below their markers).
const CALORIES_POINTS = [
  { time: '07:15', kcal: 41 },
  { time: '08:42', kcal: 57 },
  { time: '10:51', kcal: 62 },
  { time: '14:22', kcal: 38 },
  { time: '16:33', kcal: 55 },
  { time: '18:54', kcal: 49 },
  { time: '18:54', kcal: 49 },
  { time: '19:00', kcal: 22 },
  { time: '19:30', kcal: 19 },
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
  const router = useRouter();
  const [period, setPeriod] = useState('today');

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
    {/* Background texture overlay — Figma 342:9419 `imgMyStats`. Soft
        radial glow (faint blue top-right, faint green left) on top of the
        dark page background. pointerEvents=none so it stays decorative.
        Explicit width/height + top:0 left:0 keeps RN-web from letting the
        image's natural 1920×1080 dimensions inflate the layout. */}
    <RNImage
      source={require('../../assets/my-stats-bg.png')}
      resizeMode="cover"
      pointerEvents="none"
      accessible={false}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
      }}
    />
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 100,
        alignItems: 'center',
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Top zone — StatusChart compact (Figma 342:9420, 289.733×301).
          showActionButton=false: my-stats omits the heart-rate Pressable +
          settings sub-badge (Figma block has no action button — only the
          silhouette, arcs, and heart status badge). Navigation back to the
          dashboard is handled by the Home FAB in the donut grid. */}
      <StatusChart
        condition="good"
        progress={1}
        size="compact"
        showActionButton={false}
      />

      {/* Avatar — absolute top-right, overlays the chart (Figma 342:9422) */}
      <View
        style={{
          position: 'absolute',
          right: 24,
          top: insets.top + 34,
        }}
      >
        <Avatar customSize={64} uri={avatarUri} bordered borderWidth={4} />
      </View>

      {/* User Data column — Figma 342:9966 (w 328, gap.l 24) */}
      <View style={{ width: 328, gap: theme.gap.l, marginTop: theme.gap.l }}>
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
            <Icon name="favorite" size={24} color={theme.content.primary} />
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

          <View
            style={{
              width: 1,
              height: 106,
              backgroundColor: theme.content.medium,
            }}
          />

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

          <View
            style={{
              width: 1,
              height: 106,
              backgroundColor: theme.content.medium,
            }}
          />

          {/* Col 3 — Flame 145 Kcal/hora (Figma 342:9442) */}
          <View
            style={{
              alignItems: 'center',
              gap: theme.gap.sm,
              width: 55,
            }}
          >
            <Icon
              name="local_fire_department"
              size={24}
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
          <ProgressBar
            value={74.4}
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
            Donut size="small" = 156. Single-tone gradients per arc. The
            Home FAB (Figma 348:10334) sits absolute at the geometric center
            of the grid (overlapping the 16px gap between donuts). */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.gap.m,
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          {/* Donut 1 — Esforço feito 62,5%. Green arc + green heartbeat
              icon (Figma I342:9832 — icon color matches arc). */}
          <DonutChart
            size="small"
            appearance="flat"
            title=""
            icon="heartbeat"
            iconColor={theme.content.primary}
            value="62,5%"
            label="Esforço feito"
            progress={62.5}
            progressGradient={[theme.surface.success, theme.surface.success]}
          />
          {/* Donut 2 — Oxigenação 92,2%. Blue arc + blue heartbeat icon
              (Figma I342:9833 — icon color matches arc). */}
          <DonutChart
            size="small"
            appearance="flat"
            title=""
            icon="heartbeat"
            iconColor={theme.content.secondary}
            value="92,2%"
            label="Oxigenação"
            progress={92.2}
            progressGradient={[theme.surface.secondary, theme.surface.secondary]}
          />
          {/* Donut 3 — Steps 8975 4,32km. Orange arc but GREEN footprint
              icon (Figma I342:9860 — designer chose green for the icon
              despite the orange arc; matches the original asset gradient). */}
          <DonutChart
            size="small"
            appearance="flat"
            title=""
            icon="footprint"
            iconColor={theme.content.primary}
            value="8975"
            label="4,32km"
            progress={45}
            progressGradient={[theme.surface.warning, theme.surface.warning]}
          />
          {/* Donut 4 — Kcal 125. Green arc + orange-red flame icon (Figma
              I342:9874 — flame asset uses a multi-tone gradient; surface.warning
              is the closest single-color match for the dominant upper-flame
              tone visible in the design). */}
          <DonutChart
            size="small"
            appearance="flat"
            title=""
            icon="local_fire_department"
            iconColor={theme.surface.warning}
            value="125 kcal"
            label="por hora"
            progress={70}
            progressGradient={[theme.surface.success, theme.surface.success]}
          />

          {/* Home FAB — Figma 348:10334 (absolute, center of donut grid).
              Two-tone: bg=content.dark (#f5f5f5 light) + 10px content.disable
              dark border + pill + xlarge padding. Routes to /dashboard. */}
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              marginTop: -46,
              marginLeft: -46,
            }}
          >
            <Button
              variant="contained"
              shape="pill"
              size="xlarge"
              backgroundColor={theme.content.dark}
              borderColor={theme.content.disable}
              borderWidth={10}
              elevation="lg"
              iconLeft={
                <Icon
                  name="home"
                  width={30.857}
                  height={30.857}
                  color={theme.surface.standard}
                />
              }
              accessibilityLabel="Voltar para a dashboard"
              onPress={() => router.push('/(app)/dashboard')}
            />
          </View>
        </View>

        {/* Divider — Figma 342:9905 */}
        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

        {/* Gasto calórico section — Figma 342:10219 */}
        <View style={{ width: '100%', gap: theme.gap.m }}>
          <View style={{ gap: 10 }}>
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
          {/* LineCaloriesChart — Figma 342:10223. Chart wider than container;
              horizontal ScrollView reveals further points (mostra ~3, scrolla
              o resto). Sem `fullWidth` o chart usa largura natural por ponto. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{
              backgroundColor: theme.surface.standard,
              borderRadius: theme.border.radius.m,
            }}
          >
            <LineCaloriesChart points={CALORIES_POINTS} />
          </ScrollView>
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
          <ChipGroup
            options={['Buscopan', 'Dipirona', 'Chocolate', 'Camarão']}
            mode="multiple"
            initialValue={['Buscopan', 'Dipirona', 'Chocolate', 'Camarão']}
            variant="filled"
            colorScheme="secondary"
          />
        </View>

        {/* Divider — Figma 342:9906 */}
        <View style={{ height: 2, backgroundColor: theme.surface.standard }} />

        {/* Histórico Médico — Figma 342:9907 (4 ExamInfoCard + ImageUploader) */}
        <View style={{ width: '100%', gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            HIstórico Médico
          </Title>
          {EXAMS.map((exam) => (
            <ExamInfoCard
              key={`${exam.year}-${exam.date}`}
              year={exam.year}
              date={exam.date}
              examName={exam.examName}
              compact
              mobile
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
    </View>
  );
}
