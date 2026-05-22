import { Image as RNImage, Modal, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SvgXml } from 'react-native-svg';
import {
  Button,
  Icon,
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

// Figma 385:29591 dashboard-alert-active — agora apresentado como MODAL
// sobreposto à tela de notificações (mesmo padrão visual do WeatherAlertModal
// que abriu antes). User spec: "no alerta atual ainda esta trocando de tela,
// quero ele exatamente como o meteorológico" — backdrop levemente vermelho,
// conteúdo dentro de um card branco, tap fora fecha.
//
// Conteúdo migrado do `AlertActiveView` que vivia inline em dashboard.tsx
// (state `?alert=active`). A rota original continua válida — esse componente
// só é renderizado a partir de notifications.tsx; o branch do dashboard
// permanece intacto pra qualquer outro entry point canônico.
//
// Diferença vs. o AlertActiveView original:
//   - Sem JourneyTheme/dot-grid (o backdrop do modal substitui o background)
//   - Sem NavFABs (modal não deve mostrar navegação do app por baixo)
//   - Sem `flex: 1` no ScrollView (o modal tem maxHeight definido)
//   - Botão "Entendi" e qualquer ação que antes navegava agora chama onClose
//     (continua disponível pra navegação real ex.: "Traçar rota" / "Reportar
//     acidente" — esses fecham o modal antes de navegar pra evitar
//     stale-overlay).

export interface ActiveAlertModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ActiveAlertModal({ visible, onClose }: ActiveAlertModalProps) {
  const theme = useTheme();
  const router = useRouter();

  // Bolinhas da timeline (Figma 385:29807) usam `surface/secondary` #50B3D2
  // (teal escuro). A linha vertical entre bolinhas usa cyan mais claro
  // `content/secondary` #8AD2E2 — cores DIFERENTES por design.
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

  // Helper para ações que precisam navegar: fecha primeiro pra não deixar
  // overlay sobre o destino.
  const closeAndGo = (href: Parameters<typeof router.push>[0]) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Fechar alerta atual"
        style={{
          flex: 1,
          // Mesmo backdrop do WeatherAlertModal — surface.error (#f5667a) ~18%
          // opacity. Sinal visual de emergência sem trocar o fundo da tela.
          backgroundColor: 'rgba(245, 102, 122, 0.18)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.padding.m,
        }}
      >
        {/* Inner Pressable absorve o toque pra não fechar quando o user
            clica DENTRO do modal. */}
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth: 360,
            maxHeight: '90%',
            backgroundColor: theme.surface.standard,
            borderRadius: theme.border.radius.m,
            overflow: 'hidden',
          }}
        >
          <ScrollView
            contentContainerStyle={{
              padding: theme.padding.m,
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
              {/* Condition card (Figma 385:30119) — flex pra preencher o
                  espaço restante do modal. Conteúdo justify-end com ícone
                  de chuva flutuando 28px acima do topo. */}
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
                }}
              >
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
                  17ºC
                </Title>
                <Text variant="body.m" color={theme.content.dark}>
                  Chuva Intensa
                </Text>
              </View>

              {/* Data column (Figma 385:30123) — width fixa 83px. */}
              <View style={{ width: 83, gap: theme.gap.s }}>
                <WeatherDataRow svg={WATER_DROP_SVG} svgW={14} svgH={20} value="65%" theme={theme} />
                <WeatherDataRow svg={WIND_SPEED_SVG} svgW={20} svgH={17} value="65km/h" theme={theme} />
                <WeatherDataRow svg={ARROW_UP_TRIANGLE_SVG} svgW={22} svgH={19} value="32ºC" theme={theme} />
                <WeatherDataRow svg={ARROW_DOWN_TRIANGLE_SVG} svgW={22} svgH={19} value="19ºC" theme={theme} />
              </View>
            </View>

            {/* Description */}
            <Text
              variant="body.s"
              color={theme.content.dark}
              style={{ textAlign: 'center' }}
            >
              Risco de desabamentos nas primeiras horas do dia, procure a rota de
              siga as instruções para a evacuação.
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
                    onPress={() => closeAndGo('/(app)/evacuation')}
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
                    onPress={() => closeAndGo('/(app)/reports/new')}
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
                onPress={onClose}
              />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
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
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        <SvgXml xml={svg} width={svgW} height={svgH} />
      </View>
      <Text variant="body.m" color={theme.content.dark}>
        {value}
      </Text>
    </View>
  );
}
