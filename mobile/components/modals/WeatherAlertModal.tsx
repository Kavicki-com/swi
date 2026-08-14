import { Image as RNImage, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import {
  Button,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import {
  ARROW_DOWN_TRIANGLE_SVG,
  ARROW_UP_TRIANGLE_SVG,
  WATER_DROP_SVG,
  WIND_SPEED_SVG,
} from '../../lib/alertWeatherSvgs';
import { useWeather } from '../../services/weather/WeatherProvider';
import { weatherDisplay } from '../../services/weather/weatherFormat';

// title + row (weather-condition card + weather-data metrics) + body text +
// "Instruções de segurança" CTA pink/coral.
//
// Reusable shape: a rota wrapper em `app/modals/weather-alert.tsx` provê
// backdrop + animação; non-route call sites (push-notification handler etc.)
// podem renderizar este body dentro do próprio container.
//
// Card de temperatura segue o mesmo padrão do dashboard-alert-active:
// fundo `surface.high`, content `justify-end`, ícone de chuva flutuando
//
// Ícones das métricas vêm de `alertWeatherSvgs.ts` (SVGs exportados direto
// com barra interna, wind_speed/air com end-caps circulares, arrows menores).

export interface WeatherAlertModalProps {
  onClose: () => void;
  onPrimaryAction: () => void;
}

export function WeatherAlertModal({ onPrimaryAction }: WeatherAlertModalProps) {
  const theme = useTheme();

  // Clima real (Unit 2) com fallback pro texto estático de hoje em
  // loading/error/sem-alerta — esta é tela de segurança e nunca pode quebrar.
  const { snapshot, activeAlert } = useWeather();
  const { tempStr, condStr, humStr, windStr, maxStr, minStr, descStr } = weatherDisplay(snapshot, activeAlert);

  return (
    <View
      style={{
        width: '100%',
        maxWidth: 320,
        backgroundColor: theme.surface.standard,
        paddingVertical: theme.padding.m,
        paddingHorizontal: theme.padding.sm,
        borderRadius: theme.border.radius.m,
        gap: theme.gap.m,
        alignItems: 'center',
      }}
    >
      <Title variant="title.xs" color={theme.content.dark}>
        Local em Alerta!
      </Title>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <View
          style={{
            flex: 1,
            height: 100,
            backgroundColor: theme.surface.high,
            borderRadius: theme.border.radius.m,
            paddingHorizontal: theme.padding.s,
            paddingBottom: theme.padding.s,
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: theme.gap.s,
            position: 'relative',
            marginRight: theme.gap.m,
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -28,
              alignSelf: 'center',
              zIndex: 2,
            }}
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
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            {condStr}
          </Text>
        </View>

        <View style={{ width: 83, gap: theme.gap.s }}>
          <MetricRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value={humStr} theme={theme} />
          <MetricRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value={windStr} theme={theme} />
          <MetricRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value={maxStr} theme={theme} />
          <MetricRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value={minStr} theme={theme} />
        </View>
      </View>

      <View style={{ width: '100%', gap: theme.gap.s }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ textAlign: 'center' }}
        >
          {descStr}
        </Text>

        <Button
          variant="contained"
          backgroundColor={theme.surface.error}
          labelColor={theme.content.light}
          label="Instruções de segurança"
          fullWidth
          elevation="lg"
          accessibilityLabel="Instruções de segurança"
          onPress={onPrimaryAction}
        />
      </View>
    </View>
  );
}

// Local component (não exportado) — uma row icon+text para a coluna de
// métricas. Container 24×24 mantém alinhamento vertical entre rows mesmo
// com ícones de tamanhos intrínsecos diferentes.
function MetricRow({
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <SvgXml xml={svg} width={svgW} height={svgH} />
      </View>
      <Text variant="body.m" color={theme.content.dark}>
        {value}
      </Text>
    </View>
  );
}
