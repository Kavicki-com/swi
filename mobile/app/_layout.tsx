import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { AuthProvider } from '../services/auth/AuthProvider';

SplashScreen.preventAutoHideAsync();

// Mobile-frame constraint na web: força o app a 360px de largura (a mesma
// largura do design Figma) centralizado horizontalmente. Em native (iOS /
// Android prod build) o `Platform.OS === 'web'` é false e o app renderiza
// full-screen como esperado. Resolve o caso de browsers desktop largos
// onde o form ficava à esquerda e o fundo do gradient esticava em landscape.
// 2026-05-18.
const IS_WEB = Platform.OS === 'web';
const rootContainerStyle = IS_WEB
  ? { flex: 1, backgroundColor: '#000' }
  : { flex: 1 };
const mobileFrameStyle = IS_WEB
  ? { flex: 1, maxWidth: 360, width: '100%' as const, alignSelf: 'center' as const }
  : { flex: 1 };

// If Google Fonts CDN is unreachable (offline / blocked), useFonts will never
// flip `fontsLoaded` to true and the splash stays forever. Bound the wait to
// 5s and continue with system fonts — RN gracefully falls back when a
// requested fontFamily is missing, so the app renders (with degraded typo
// fidelity) instead of hanging on the splash. The same fallback covers a
// real load error (useFonts returns an Error in slot [1] which we surface).
const FONT_LOAD_TIMEOUT_MS = 5000;

export default function RootLayout() {
  // DS theme.fontFamily.body = 'Inter', theme.fontFamily.title = 'Montserrat'.
  // Native: useFonts mapeia nome -> arquivo. RN não consulta weight descriptor;
  // basta carregar o arquivo certo sob o nome que o DS pede.
  // Web: useFonts registra a FontFace com weight=normal independente do arquivo.
  // Quando CSS pede `Montserrat 700`, o browser não acha o face com weight 700
  // e aplica synthetic-bold em cima do arquivo (que já é Bold), gerando peso
  // impreciso. Solução: no web pulamos useFonts e registramos os 6 variants via
  // FontFace API com weight descriptor explícito no useEffect abaixo.
  const [fontsLoadedNative, fontError] = useFonts(
    IS_WEB
      ? {}
      : {
          Inter: Inter_400Regular,
          'Inter-Medium': Inter_500Medium,
          'Inter-Bold': Inter_700Bold,
          Montserrat: Montserrat_700Bold,
          'Montserrat-Regular': Montserrat_400Regular,
          'Montserrat-Medium': Montserrat_500Medium,
        }
  );
  const [webFontsLoaded, setWebFontsLoaded] = useState(false);
  const fontsLoaded = IS_WEB ? webFontsLoaded : fontsLoadedNative;
  const [fontTimeout, setFontTimeout] = useState(false);

  useEffect(() => {
    if (!IS_WEB) return;
    let cancelled = false;
    const faces: Array<{ family: string; weight: string; url: unknown }> = [
      { family: 'Inter', weight: '400', url: Inter_400Regular },
      { family: 'Inter', weight: '500', url: Inter_500Medium },
      { family: 'Inter', weight: '700', url: Inter_700Bold },
      { family: 'Montserrat', weight: '400', url: Montserrat_400Regular },
      { family: 'Montserrat', weight: '500', url: Montserrat_500Medium },
      { family: 'Montserrat', weight: '700', url: Montserrat_700Bold },
    ];
    Promise.allSettled(
      faces.map(async ({ family, weight, url }) => {
        const u = url as string | { uri?: string; default?: string } | undefined;
        const href = typeof u === 'string' ? u : u?.uri ?? u?.default;
        if (!href) return;
        const face = new FontFace(family, `url(${href})`, { weight });
        const loaded = await face.load();
        if (!cancelled) (document as Document & { fonts: FontFaceSet }).fonts.add(loaded);
      })
    ).finally(() => {
      if (!cancelled) setWebFontsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);

  // Ready to render once fonts arrived, errored, or the timeout fired.
  const ready = fontsLoaded || !!fontError || fontTimeout;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={rootContainerStyle}>
      <SafeAreaProvider>
        <SwiThemeProvider>
          <AuthProvider>
            <View style={mobileFrameStyle}>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(onboarding)" />
                <Stack.Screen name="(app)" />
                <Stack.Screen name="modals/support-form" options={{ presentation: 'transparentModal' }} />
                <Stack.Screen name="modals/privacy-policy" options={{ presentation: 'transparentModal' }} />
                <Stack.Screen name="modals/weather-alert" options={{ presentation: 'transparentModal' }} />
              </Stack>
            </View>
          </AuthProvider>
        </SwiThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
