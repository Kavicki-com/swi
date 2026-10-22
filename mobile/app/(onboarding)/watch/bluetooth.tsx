import { Image, Platform, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, StatusTag, StepBar, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { BluetoothHeartRateMonitoring } from '../../../components/telemetry/BluetoothHeartRateMonitoring';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import {
  androidFirstUseProgress,
  BLUETOOTH_FIRST_USE_COPY as COPY,
  FIRST_USE_END,
  FIRST_USE_FOOTER_COPY as RODAPE,
  nextAndroidFirstUseRoute,
} from '../../../services/telemetry/androidFirstUse';
import { useBandChoice } from '../../../services/telemetry/bluetooth/bluetoothBandChoice';

// Última etapa do primeiro uso no Android (ADR-0013): a pulseira por
// Bluetooth, o acréscimo do batimento ao vivo para os modelos que o ligam.
// É opcional e diz isso, porque a maioria das pulseiras não transmite; e
// aqui moram os avisos da ADR-0010, que deixou com o primeiro uso como
// avisar: transmitir gasta bateria e, em algumas marcas, disputa a conexão
// com o app do fabricante. A escolha é a mesma de Configurações,
// Monitoramento (BluetoothHeartRateMonitoring.tsx); esta tela só a
// apresenta.

export default function WatchBluetooth() {
  if (!isFeatureEnabled('watchOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  // O módulo da pulseira por Bluetooth só existe no Android compilado.
  if (Platform.OS !== 'android' || !isFeatureEnabled('bluetoothHeartRate')) {
    return <Redirect href={FIRST_USE_END} />;
  }
  return <WatchBluetoothScreen />;
}

function WatchBluetoothScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const escolhida = useBandChoice() != null;

  const seguir = () => router.replace(nextAndroidFirstUseRoute('bluetooth'));

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
        <StepBar {...androidFirstUseProgress('bluetooth')} />

        <View style={{ gap: theme.gap.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
            <Title variant="title.s" color={theme.content.dark}>
              {COPY.titulo}
            </Title>
            <StatusTag status="info" label={COPY.opcional} />
          </View>
          <Text variant="body.m" color={theme.content.dark}>
            {COPY.corpo}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {COPY.soBatimento}
          </Text>
        </View>

        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            {COPY.avisoTitulo}
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            {COPY.bateria}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {COPY.competicao}
          </Text>
        </View>

        <BluetoothHeartRateMonitoring />
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.padding.m,
          paddingBottom: insets.bottom + theme.gap.m,
          paddingTop: theme.gap.s,
          gap: theme.gap.sm,
        }}
      >
        {escolhida ? (
          <Button variant="contained" label={RODAPE.continuar} fullWidth onPress={seguir} />
        ) : (
          <Button variant="outline" label={RODAPE.configurarDepois} fullWidth onPress={seguir} />
        )}
      </View>
    </View>
  );
}
