import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, SmartbandStatus, Title, useTheme } from '@kavicki/swi-design-system';
import { Smartwatch3D } from '../../../components/Smartwatch3D';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';

export default function SmartbandComplete() {
  if (!isFeatureEnabled('smartbandOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <SmartbandCompleteScreen />;
}

function SmartbandCompleteScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
          paddingTop: insets.top + 26,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: theme.padding.m,
        }}
      >
        <Title
          variant="title.s"
          color={theme.content.dark}
          style={{ textAlign: 'center', alignSelf: 'stretch' }}
        >
          Finalizando configuração
        </Title>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Smartwatch3D width={320} height={347} autoRotate interactive scale={1.2} />
        </View>

        <View style={{ gap: theme.gap.m }}>
          <SmartbandStatus
            progress={1}
            heartRate={88}
            bloodPressure="12/8"
            message="Configuração concluída, toque finalizar para continuar"
          />
          <Button
            variant="contained"
            label="Finalizar"
            fullWidth
            onPress={() => router.replace('/(app)/dashboard')}
          />
        </View>
      </View>
    </View>
  );
}
