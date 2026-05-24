import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { Asset } from 'expo-asset';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Path-direct imports: o barrel `@expo-google-fonts/{inter,montserrat}`
// força require() estático de TODOS os 18 weights (incl. Italic/Thin/Black).
// Metro não tree-shake `require()` → ~30 .ttf desnecessários no bundle (~1.5MB).
// Importando por subpath, só os 6 pesos usados entram no bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Montserrat_400Regular } from '@expo-google-fonts/montserrat/400Regular';
import { Montserrat_500Medium } from '@expo-google-fonts/montserrat/500Medium';
import { Montserrat_700Bold } from '@expo-google-fonts/montserrat/700Bold';
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
// 2s e continue com fontes do sistema — RN cai gracefully quando uma
// fontFamily pedida falta, então o app renderiza (com tipo degradado)
// em vez de pendurar no splash. T5.4 reduziu de 5s → 2s pra acelerar
// first-paint em conexões lentas / cache invalidado.
const FONT_LOAD_TIMEOUT_MS = 2000;

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
      // Family-resolved aliases para que CSS pedindo 'Inter-Medium' ache o face.
      // O peso fica 'normal' porque a family já carrega o peso correto.
      { family: 'Inter-Medium', weight: 'normal', url: Inter_500Medium },
      { family: 'Inter-Bold', weight: 'normal', url: Inter_700Bold },
      { family: 'Montserrat-Regular', weight: 'normal', url: Montserrat_400Regular },
      { family: 'Montserrat-Medium', weight: 'normal', url: Montserrat_500Medium },
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

  // Preload do background único (login-bg.png) + smartwatch.glb (~4.2MB, usado
  // em 2 telas de onboarding). Best-effort: roda em paralelo com fonts e não
  // gateia o render. Warming do cache do Metro/Expo Asset → primeira navegação
  // ao smartband já tem o GLB local, sobrando apenas o parse (~2-3s) em vez de
  // download (~3-5s) + parse. Falha silenciosa: require() em runtime ainda
  // resolve no use-time se o preload falhar.
  useEffect(() => {
    Asset.loadAsync([
      require('../assets/login-bg.png'),
      require('../assets/smartwatch.glb'),
    ]).catch(() => {});
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
              {/* freezeOnBlur: pausa renderização de telas cached no Stack
                  (useFrame do Smartwatch3D + setInterval do journey/task param
                  ao navegar adiante). animation:'fade' + duration:200 corta
                  ~150ms por navegação vs default ~300ms slide. */}
              <Stack
                screenOptions={{
                  headerShown: false,
                  freezeOnBlur: true,
                  animation: 'fade',
                  animationDuration: 200,
                }}
              >
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
