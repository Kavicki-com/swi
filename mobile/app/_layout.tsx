import 'react-native-reanimated';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
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

export default function RootLayout() {
  // DS theme.fontFamily.body = 'Inter', theme.fontFamily.title = 'Montserrat'.
  // Estratégia: registrar a variante mais comum (e mais difícil de corrigir via
  // synthetic) com o nome puro que o DS espera. RN não faz bridge automático
  // entre nomes de família com pesos diferentes — quem o DS pede via fontFamily
  // tem que vir resolvido.
  //   - Inter → Regular (400). Uso predominante no DS é body/subtitle/caption regular.
  //   - Montserrat → Bold (700). DS usa Montserrat exclusivamente para títulos e
  //     button labels, todos com fontWeight 700 (ver tokens/typography.ts e
  //     Button.styles.ts). Carregar o Bold como 'Montserrat' garante weight real.
  // Aliases ficam disponíveis para futuro DS bump weight-aware.
  const [fontsLoaded] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-Bold': Inter_700Bold,
    Montserrat: Montserrat_700Bold,
    'Montserrat-Regular': Montserrat_400Regular,
    'Montserrat-Medium': Montserrat_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <SwiThemeProvider>
        <AuthProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="modals/support-form" options={{ presentation: 'modal' }} />
            <Stack.Screen name="modals/privacy-policy" options={{ presentation: 'modal' }} />
            <Stack.Screen name="modals/weather-alert" options={{ presentation: 'transparentModal' }} />
            <Stack.Screen name="modals/responsables" options={{ presentation: 'modal' }} />
          </Stack>
        </AuthProvider>
      </SwiThemeProvider>
    </SafeAreaProvider>
  );
}
