import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SmartbandStatus, Title, useTheme } from '@kavicki/swi-design-system';
// 3D Smartwatch3D temporarily reverted to a static PNG while we sort out
// three.js `import.meta` interop with Metro web. See components/Smartwatch3D.tsx
// for the working component once expo-gl native build is wired.

const SYNC_DURATION_MS = 3000;
const TICK_MS = 100;

export default function SmartbandPairing() {
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
          paddingHorizontal: 16,
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
          <Image
            source={require('../../../assets/smartwatch.png')}
            resizeMode="contain"
            style={{ width: 320, height: 347 }}
          />
        </View>

        <SmartbandStatus
          progress={progress}
          message="Sincronizando sua Smartband, por favor aguarde..."
        />
      </View>
    </View>
  );
}
