import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import {
  Button,
  Icon,
  JourneyTheme,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../NavFABs';
import {
  ARROW_DOWN_TRIANGLE_SVG,
  ARROW_UP_TRIANGLE_SVG,
  WATER_DROP_SVG,
  WIND_SPEED_SVG,
} from '../../lib/alertWeatherSvgs';
import { useWeather } from '../../services/weather/WeatherProvider';
import { weatherDisplay } from '../../services/weather/weatherFormat';

// Tela "Procedimento de evacuação" (Figma 385:29591 dashboard-alert-active).
// Antes vivia em `app/(app)/alert-instructions.tsx`; por decisão de 2026-05-15,
// dashboard e instruções são a mesma rota com dois estados, e este componente
// serve o branch `?alert=active`.
//
// Extraída do dashboard.tsx na Task 5 do plano de entrega, sem alteração de
// comportamento: é tela de segurança, coberta por dashboard.integration.test.
export function AlertActiveView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Clima real (Unit 2) com fallback pro texto estático de hoje em
  // loading/error/sem-alerta — esta é tela de segurança e nunca pode quebrar.
  const { snapshot, activeAlert } = useWeather();
  const { tempStr, condStr, humStr, windStr, maxStr, minStr, descStr } = weatherDisplay(snapshot, activeAlert);

  // Bolinhas da timeline (Figma 385:29807 etc.) usam `surface/secondary`
  // #50B3D2 (teal escuro). A linha vertical entre bolinhas usa um cyan
  // mais claro `content/secondary` #8AD2E2 — cores DIFERENTES por design.
  const stepCircle = (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.surface.secondary,
        marginTop: 2,
      }}
    />
  );

  // Cada item exceto o último ganha um segmento de linha que vai do
  // centro da bolinha até o final do item, conectando com o próximo
  // segmento na próxima bolinha. Isso garante que a linha SEMPRE termine
  // no centro da última bolinha (independente da altura dos items).
  // `top: 12` = bolinha marginTop(2) + raio(10) → centro vertical.
  const lineSegment = (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 9,
        top: 12,
        bottom: -theme.gap.m,
        width: 1,
        backgroundColor: theme.content.secondary,
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Dot-grid (Figma 385:29751 "Repetição de grade 4") — 27 colunas,
          opacity 9%, centrado no topo. Mesma camada do dashboard/my-stats. */}
      <JourneyTheme />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.m,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={{ alignItems: 'center' }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Procedimento de evacuação
          </Title>
        </View>

        {/* Weather row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.gap.m,
          }}
        >
          {/* Left: condition card (Figma 385:30119). Fixed 203×100. Content
              alinha bottom (justify-end) pra deixar espaço pro ícone de chuva
              transbordar o topo do card. Padding só horizontal+bottom — top
              fica zero pra não empurrar texto pra baixo do ícone. */}
          <View
            style={{
              width: 203,
              height: 100,
              backgroundColor: theme.surface.high,
              borderRadius: theme.border.radius.m,
              paddingHorizontal: theme.padding.s,
              paddingBottom: theme.padding.s,
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: theme.gap.s,
            }}
          >
            {/* Ícone de chuva (Figma 385:30122) — 72×72.76 posicionado
                top:-28.38 (transborda o topo do card, ~40% fica fora). DS
                WeatherIcon 404 com asset path em node_modules; renderiza
                direto via RNImage do mobile/assets/. */}
            <View
              style={{
                position: 'absolute',
                top: -28,
                alignSelf: 'center',
                zIndex: 2,
              }}
              pointerEvents="none"
            >
              <RNImage
                source={require('../../assets/weather-rainy.png')}
                style={{ width: 72, height: 72 }}
                resizeMode="contain"
                accessibilityLabel="Chuva intensa"
              />
            </View>
            <Title variant="title.l" color={theme.content.dark}>
              {tempStr}
            </Title>
            <Text variant="body.m" color={theme.content.dark}>
              {condStr}
            </Text>
          </View>

          {/* Right: data column (Figma 385:30123). Width fixa 83px. Os
              4 ícones vêm dos SVGs do Figma (alertWeatherSvgs) porque
              os equivalentes do DS têm shapes diferentes. */}
          <View style={{ width: 83, gap: theme.gap.s }}>
            <WeatherDataRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value={humStr} theme={theme} />
            <WeatherDataRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value={windStr} theme={theme} />
            <WeatherDataRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value={maxStr} theme={theme} />
            <WeatherDataRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value={minStr} theme={theme} />
          </View>
        </View>

        {/* Description */}
        <Text
          variant="body.s"
          color={theme.content.dark}
          style={{ textAlign: 'center' }}
        >
          {descStr}
        </Text>

        {/* Instructions list */}
        <View style={{ gap: theme.gap.m }}>
          {/* Step 1 — Traçar rota */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Desloque-se para o local de resgate
              </Text>
              <Button
                variant="contained"
                size="small"
                backgroundColor={theme.surface.primary}
                labelColor={theme.content.light}
                label="Traçar rota"
                iconRight={
                  <Icon
                    name="location_pin"
                    width={20}
                    height={25}
                    color={theme.content.light}
                  />
                }
                elevation="lg"
                accessibilityLabel="Traçar rota de evacuação"
                onPress={() => router.push('/(app)/evacuation')}
              />
            </View>
          </View>

          {/* Step 2 — Mantenha-se em abrigo */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <Text
              variant="body.m"
              color={theme.content.dark}
              style={{ flex: 1 }}
            >
              Mantenha se em um abrigo protegido do vento
            </Text>
          </View>

          {/* Step 3 — Espere pelo veículo + chip */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            {lineSegment}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Espere pelo veículo de resgate
              </Text>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.content.primary,
                  borderRadius: theme.border.radius.m,
                  paddingHorizontal: theme.padding.sm,
                  paddingVertical: theme.padding.xs,
                }}
              >
                <Text variant="body.s" color={theme.content.primary}>
                  Aprox. 7 minutos
                </Text>
              </View>
            </View>
          </View>

          {/* Step 4 — Reportar acidente (último item, sem lineSegment). */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <View style={{ flex: 1, gap: 12, alignItems: 'flex-start' }}>
              <Text variant="body.m" color={theme.content.dark}>
                Se você ou alguém estiver ferido, reporte imediatamente à central
              </Text>
              <Button
                variant="contained"
                size="small"
                backgroundColor={theme.surface.accent}
                labelColor={theme.content.light}
                label="Reportar acidente"
                elevation="lg"
                accessibilityLabel="Reportar acidente"
                onPress={() => router.push('/(app)/reports/new')}
              />
            </View>
          </View>
        </View>

        {/* Confirmation block */}
        <View style={{ gap: 15 }}>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            Mantenha-se calmo. Estamos à caminho.
          </Text>
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Entendi, estou seguindo as instruções"
            fullWidth
            elevation="lg"
            accessibilityLabel="Confirmar instruções recebidas"
            onPress={() => router.replace('/(app)/dashboard')}
          />
        </View>
      </ScrollView>

      <NavFABs />
    </View>
  );
}

function WeatherDataRow({
  theme,
  svg,
  svgW,
  svgH,
  value,
}: {
  theme: ReturnType<typeof useTheme>;
  svg: string;
  svgW: number;
  svgH: number;
  value: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.s,
      }}
    >
      {/* Container 24x24 igual aos antigos ícones do DS pra manter
          alinhamento vertical entre as 4 rows; ícone fica centralizado
          dentro mas usa seu tamanho intrínseco do Figma. */}
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <SvgXml xml={svg} width={svgW} height={svgH} />
      </View>
      <Text variant="body.m" color={theme.content.dark}>
        {value}
      </Text>
    </View>
  );
}
