import { useCallback, useEffect, useRef } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SmartbandStatus, Title, useTheme } from '@kavicki/swi-design-system';
import { Smartwatch3D } from '../../../components/Smartwatch3D';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import { useWatchDiagnostics } from '../../../services/telemetry/watchDiagnostics';

// Segunda tela do primeiro uso: espera a sessão espelhada ou a primeira
// leitura chegar do relógio. Antes daqui havia uma barra que enchia sozinha em
// três segundos sem observar aparelho nenhum.
//
// A barra do DS fica indeterminada de propósito: não há progresso real a
// mostrar, e fingir um seria a mesma mentira de antes.

/** Teto da espera. Sem ele, quem não autorizou fica olhando o relógio girar. */
const TETO_MS = 30_000;

export default function WatchConnectionStart() {
  if (!isFeatureEnabled('watchOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <WatchConnectionStartScreen />;
}

function WatchConnectionStartScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const estado = useWatchDiagnostics();

  // A saída acontece uma vez só: a leitura pode chegar no mesmo instante em que
  // o teto vence, e duas navegações empilhariam telas.
  const saiu = useRef(false);
  const seguir = useCallback(() => {
    if (saiu.current) return;
    saiu.current = true;
    router.replace('/(onboarding)/watch/complete');
  }, [router]);

  const chegou =
    estado.support === 'unsupported' ||
    estado.session === 'running' ||
    estado.lastSample !== null;

  useEffect(() => {
    if (chegou) seguir();
  }, [chegou, seguir]);

  useEffect(() => {
    const teto = setTimeout(seguir, TETO_MS);
    return () => clearTimeout(teto);
  }, [seguir]);

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
          Ativando o monitoramento
        </Title>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Smartwatch3D width={320} height={347} autoRotate interactive scale={2.0} />
        </View>

        <SmartbandStatus progress={0} message="Aguardando o seu Apple Watch..." />
      </View>
    </View>
  );
}
