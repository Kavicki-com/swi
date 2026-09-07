import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, SmartbandStatus, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { Smartwatch3D } from '../../../components/Smartwatch3D';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { useWatchDiagnostics } from '../../../services/telemetry/watchDiagnostics';
import { deriveTelemetryAvailability } from '../../../services/telemetry/telemetryAvailability';
import { markWatchOnboardingComplete } from '../../../services/telemetry/watchOnboarding';
import { telemetryCopy } from '../../../services/telemetry/telemetryCopy';
import { useNow } from '../../../services/telemetry/useNow';

// Última tela do primeiro uso. Diz o que de fato chegou do relógio, e deixa
// entrar no app em qualquer caso: telemetria ausente não barra o funcionário
// (ADR-0004). Nenhum texto aqui afirma que a permissão foi negada, porque o
// iOS não conta isso.

const pad = (n: number) => String(n).padStart(2, '0');

function formatHoraLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function WatchComplete() {
  if (!isFeatureEnabled('watchOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <WatchCompleteScreen />;
}

function WatchCompleteScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const estado = useWatchDiagnostics();
  const disponibilidade = deriveTelemetryAvailability(estado, useNow());
  const copy = telemetryCopy(disponibilidade, 'primeiro-uso');

  const finalizar = async () => {
    // Gravar é conveniência; falhar só repete uma tela. Entrar no app não pode
    // depender disso.
    await markWatchOnboardingComplete(new Date().toISOString()).catch(() => undefined);
    router.replace('/(app)/dashboard');
  };

  // Só a leitura ATUAL rende o painel de "tudo certo". Uma leitura de dois
  // minutos é desatualizada, e chamá-la de ativa apagaria o estado que o
  // glossário criou justamente para distingui-la.
  const atual = disponibilidade.kind === 'current' ? disponibilidade : null;
  const desatualizada = disponibilidade.kind === 'stale' ? disponibilidade : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/smartband-bg-pattern.png')}
        resizeMode="cover"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + theme.gap.l,
          paddingBottom: insets.bottom + theme.gap.xxl,
          paddingHorizontal: theme.padding.m,
        }}
      >
        <Title
          variant="title.s"
          color={theme.content.dark}
          style={{ textAlign: 'center', alignSelf: 'stretch' }}
        >
          {copy.titulo}
        </Title>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Smartwatch3D width={320} height={347} autoRotate interactive scale={2.0} />
        </View>

        <View style={{ gap: theme.gap.m }}>
          {atual ? (
            // heartRate real; bloodPressure fica null porque o relógio não mede
            // pressão, e o DS renderiza o marcador de ausência.
            <SmartbandStatus
              progress={1}
              heartRate={Math.round(atual.bpm)}
              bloodPressure={null}
              message="Tudo certo, toque em Finalizar para continuar"
            />
          ) : (
            <>
              <Text variant="body.m" color={theme.content.dark}>
                {copy.corpo}
              </Text>
              {/* A leitura desatualizada continua visível com o horário: some
                  seria perder o único dado real que chegou. */}
              {desatualizada && (
                <Text variant="body.m" color={theme.content.dark}>
                  {`${Math.round(desatualizada.bpm)} bpm, medido às ${formatHoraLocal(desatualizada.measuredAt)}`}
                </Text>
              )}
            </>
          )}
          <Button
            variant="contained"
            label="Finalizar"
            fullWidth
            onPress={() => {
              void finalizar();
            }}
          />
        </View>
      </View>
    </View>
  );
}
