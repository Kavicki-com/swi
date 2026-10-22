import { Image, Platform, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, StatusTag, StepBar, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { HealthConnectPairingStep } from '../../../components/pairing/HealthConnectPairingStep';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import {
  androidFirstUseProgress,
  FIRST_USE_END,
  FIRST_USE_FOOTER_COPY as RODAPE,
  firstUseStepTag,
  HEALTH_CONNECT_FIRST_USE_COPY as COPY,
  healthConnectFirstUseItems,
  nextAndroidFirstUseRoute,
} from '../../../services/telemetry/androidFirstUse';
import { HEALTH_CONNECT_PAIRING_COPY } from '../../../services/telemetry/telemetryCopy';
import { useTelemetryUploadState } from '../../../services/telemetry/TelemetryUploadProvider';

// Segunda etapa do primeiro uso no Android (ADR-0013): o Health Connect, o
// caminho base, que funciona com qualquer pulseira cujo app grave nele. Os
// três passos aparecem na ordem (instalar ou atualizar, permitir a leitura,
// permitir em segundo plano), cada um com o estado, e a ação do passo aberto
// é a do mesmo componente do pareamento em Configurações
// (HealthConnectPairingStep.tsx). A leitura em segundo plano vem no mesmo
// pedido da leitura; quando fica de fora, o caminho é o dos ajustes.
//
// Chega aqui também quem tocou "Parear depois", e "Configurar depois" segue
// sem pedir nem registrar nada: nenhum dos dois é negação.

export default function WatchHealthConnect() {
  if (!isFeatureEnabled('watchOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  // O iPhone tem o fluxo do relógio e nunca passa por aqui.
  if (Platform.OS !== 'android' || !isFeatureEnabled('healthConnect')) {
    return <Redirect href={FIRST_USE_END} />;
  }
  return <WatchHealthConnectScreen />;
}

function WatchHealthConnectScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { paired, healthConnect, openHealthConnectSettings } = useTelemetryUploadState();

  const passos = healthConnectFirstUseItems(healthConnect);
  const estadoDe = (id: (typeof passos)[number]['id']) =>
    passos.find((passo) => passo.id === id)?.state ?? null;
  const leituraPermitida = estadoDe('read') === 'done';
  const faltaSegundoPlano = leituraPermitida && estadoDe('background') === 'pending';

  const seguir = () => router.replace(nextAndroidFirstUseRoute('health-connect'));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Image
        source={require('../../../assets/smartband-bg-pattern.png')}
        resizeMode="cover"
        accessible={false}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.gap.l,
          paddingHorizontal: theme.padding.m,
          paddingBottom: theme.gap.l,
          gap: theme.gap.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <StepBar {...androidFirstUseProgress('health-connect')} />

        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.s" color={theme.content.dark}>
            {COPY.titulo}
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            {COPY.corpo}
          </Text>
        </View>

        <View style={{ gap: theme.gap.m }}>
          {passos.map((passo) => {
            const etiqueta = firstUseStepTag(passo.state);
            return (
              <View
                key={passo.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}
              >
                <Text variant="body.m" color={theme.content.dark} style={{ flex: 1 }}>
                  {passo.label}
                </Text>
                <StatusTag status={etiqueta.status} label={etiqueta.label} />
              </View>
            );
          })}
        </View>

        <HealthConnectPairingStep pareado={paired} />

        {faltaSegundoPlano && (
          <View style={{ gap: theme.gap.m }}>
            <Text variant="body.m" color={theme.content.dark}>
              {COPY.semSegundoPlano}
            </Text>
            <Button
              variant="outline"
              label={HEALTH_CONNECT_PAIRING_COPY.abrirAjustes}
              fullWidth
              onPress={openHealthConnectSettings}
            />
          </View>
        )}
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.padding.m,
          paddingBottom: insets.bottom + theme.gap.m,
          paddingTop: theme.gap.s,
          gap: theme.gap.sm,
        }}
      >
        {leituraPermitida ? (
          <Button variant="contained" label={RODAPE.continuar} fullWidth onPress={seguir} />
        ) : (
          <Button variant="outline" label={RODAPE.configurarDepois} fullWidth onPress={seguir} />
        )}
      </View>
    </View>
  );
}
