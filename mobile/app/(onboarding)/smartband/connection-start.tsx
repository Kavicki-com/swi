import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SmartbandStatus, Title, useTheme } from '@kavicki/swi-design-system';
import { Smartwatch3D } from '../../../components/Smartwatch3D';
import { ProdOnlyPlaceholder } from '../../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../../lib/featureFlags';

// Figma 215:17901 — smartband-connection-start. Renamed from `pairing.tsx`
// on 2026-05-17 to match the Figma frame name (audit reconciliation).
// Content unchanged: animated 3D smartband + sync progress bar, auto-advances
// to /smartband/complete when progress reaches 1.

const SYNC_DURATION_MS = 3000;
const TICK_MS = 100;

export default function SmartbandConnectionStart() {
  if (!isFeatureEnabled('smartbandOnboarding')) {
    return <ProdOnlyPlaceholder />;
  }
  return <SmartbandConnectionStartScreen />;
}

function SmartbandConnectionStartScreen() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Demo sync animation. In production this would mirror real BLE state.
    const interval = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(1, p + TICK_MS / SYNC_DURATION_MS);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 1) {
      const t = setTimeout(() => {
        router.replace('/(onboarding)/smartband/complete');
      }, 400);
      return () => clearTimeout(t);
    }
  }, [progress, router]);

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
          Iniciando a configuração...
        </Title>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Smartwatch3D width={320} height={347} autoRotate interactive scale={2.0} />
        </View>

        <SmartbandStatus
          progress={progress}
          message="Sincronizando sua Smartband, por favor aguarde..."
        />
      </View>
    </View>
  );
}
