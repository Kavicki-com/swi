import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Title, TopBar, useTheme } from '@kavicki/swi-design-system';
import {
  useWatchDiagnostics,
  type WatchDiagnosticsState,
} from '../../../services/telemetry/watchDiagnostics';

// Superfície diagnóstica do gate técnico (Task 1 do piloto Apple Watch).
// Mostra o que o iPhone recebe da sessão espelhada: estado e última amostra
// de BPM com horário. Sem backend, sem média, sem dado simulado.

const pad = (n: number) => String(n).padStart(2, '0');

function formatHoraLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function titulo(state: WatchDiagnosticsState): string {
  if (state.support === 'unsupported') return 'Sem suporte neste aparelho';
  switch (state.session) {
    case 'running':
      return 'Sessão espelhada ativa';
    case 'ended':
      return 'Sessão encerrada';
    default:
      return 'Aguardando sessão do relógio';
  }
}

function descricao(state: WatchDiagnosticsState): string {
  if (state.support === 'unsupported') {
    return 'Disponível apenas no iPhone com o SWI instalado pela TestFlight e pareado a um Apple Watch.';
  }
  switch (state.session) {
    case 'running':
      return state.sessionChangedAt
        ? `Recebendo do Apple Watch desde ${formatHoraLocal(state.sessionChangedAt)}.`
        : 'Recebendo do Apple Watch.';
    case 'ended':
      return state.sessionChangedAt
        ? `Encerrada às ${formatHoraLocal(state.sessionChangedAt)}. A última amostra fica visível com o horário.`
        : 'A última amostra fica visível com o horário.';
    default:
      return 'Abra o SWI no Apple Watch e toque em Iniciar teste. A sessão espelhada aparece aqui sozinha.';
  }
}

export default function WatchDiagnostics() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useWatchDiagnostics();

  const sample = state.support === 'ready' ? state.lastSample : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.xxl,
          paddingBottom: insets.bottom + theme.padding.xxl,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="Diagnóstico do Apple Watch" onBack={() => router.back()} />

        <View style={{ gap: theme.gap.l, marginTop: theme.padding.xxl }}>
          <View style={{ gap: theme.gap.s }}>
            <Title variant="title.xs" color={theme.content.dark}>
              {titulo(state)}
            </Title>
            <Text variant="body.s" color={theme.content.dark}>
              {descricao(state)}
            </Text>
          </View>

          {state.support === 'ready' && (
            <View style={{ gap: theme.gap.s }}>
              <Text variant="caption.s" color={theme.content.dark}>
                {state.session === 'ended' ? 'Última amostra' : 'BPM atual'}
              </Text>
              {sample ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.gap.s }}>
                  <Title variant="title.l" color={theme.content.dark}>
                    {String(Math.round(sample.bpm))}
                  </Title>
                  <Text variant="body.m" color={theme.content.dark}>
                    bpm
                  </Text>
                  <Text variant="caption.s" color={theme.content.dark}>
                    {`medido às ${formatHoraLocal(sample.measuredAt)}`}
                  </Text>
                </View>
              ) : (
                <Text variant="body.m" color={theme.content.dark}>
                  Sem amostra de BPM ainda
                </Text>
              )}
            </View>
          )}

          <Text variant="caption.s" color={theme.content.dark}>
            Gate técnico do piloto. O dado vem do HealthKit pelo espelhamento da sessão do relógio; nada é enviado ao backend nesta etapa.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
