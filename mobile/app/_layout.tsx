import 'react-native-reanimated';
import { Stack } from 'expo-router';
import { SwiThemeProvider } from '@kavicki/swi-design-system';

export default function RootLayout() {
  return (
    <SwiThemeProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="modals/support-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/privacy-policy" options={{ presentation: 'modal' }} />
        <Stack.Screen name="modals/weather-alert" options={{ presentation: 'transparentModal' }} />
        <Stack.Screen name="modals/responsables" options={{ presentation: 'modal' }} />
      </Stack>
    </SwiThemeProvider>
  );
}
