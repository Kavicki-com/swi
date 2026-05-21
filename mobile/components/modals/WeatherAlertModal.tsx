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

// Figma 385:29371 — alert-modal (weather alert). Modal estreito centrado:
// title + row (weather-condition card + weather-data metrics) + body text +
// "Instruções de segurança" CTA pink/coral.
//
// Reusable shape: a rota wrapper em `app/modals/weather-alert.tsx` provê
// backdrop + animação; non-route call sites (push-notification handler etc.)
// podem renderizar este body dentro do próprio container.
//
// Card de temperatura segue o mesmo padrão do dashboard-alert-active:
// fundo `surface.high`, content `justify-end`, ícone de chuva flutuando
// 28px acima do topo. Sem termômetro inline — figma só tem o número.
//
// Ícones das métricas vêm de `alertWeatherSvgs.ts` (SVGs exportados direto
// do Figma) porque os equivalentes do DS têm shapes diferentes (water_drop
// com barra interna, wind_speed/air com end-caps circulares, arrows menores).

export interface WeatherAlertModalProps {
  onClose: () => void;
  onPrimaryAction: () => void;
}

export function WeatherAlertModal({ onPrimaryAction }: WeatherAlertModalProps) {
  const theme = useTheme();

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
      {/* Title (Figma 385:29391) — Montserrat Bold 16px branco. */}
      <Title variant="title.xs" color={theme.content.dark}>
        Local em Alerta!
      </Title>

      {/* Weather row (Figma 385:29370) — card flex + coluna 83w, justify-between. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        {/* Weather condition card (Figma 385:29368) — content justify-end,
            ícone de chuva flutua 28px acima do topo (transborda o card). */}
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
          {/* Rainy icon (Figma 385:29365) — 72×72 absolute top:-28. */}
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
            17ºC
          </Title>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            Chuva Intensa
          </Text>
        </View>

        {/* Weather data column (Figma 385:29364) — width fixa 83px, gap 8. */}
        <View style={{ width: 83, gap: theme.gap.s }}>
          <MetricRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value="65%" theme={theme} />
          <MetricRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value="65km/h" theme={theme} />
          <MetricRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value="32ºC" theme={theme} />
          <MetricRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value="19ºC" theme={theme} />
        </View>
      </View>

      {/* Description + CTA grouped (Figma 385:29384) — gap.s entre si,
          separado do row de cima pelo gap.m do modal-level container. */}
      <View style={{ width: '100%', gap: theme.gap.s, alignItems: 'center' }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ textAlign: 'center' }}
        >
          Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.
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
