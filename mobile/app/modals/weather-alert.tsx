import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@kavicki/swi-design-system';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';

// Figma 385:29371 — alert-modal route wrapper. Provides the transparent
// backdrop + fade animation; delegates the modal body to
// `components/modals/WeatherAlertModal.tsx`. Pattern matches
// `app/modals/privacy-policy.tsx` (R-6 in 2026-05-17-mobile-routes-audit.md).
export default function WeatherAlertModalRoute() {
  const theme = useTheme();
  const router = useRouter();
  const close = () => router.back();
  // Modal CTA "Instruções de segurança" → vai pra dashboard?alert=active
  // (timeline com bolinhas + botão Traçar rota). Padronizado com o modal
  // inline do dashboard pra mesmo entry point quando vem do map-weather.
  const goInstructions = () => router.replace('/(app)/dashboard?alert=active');

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
        }}
      />

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.overlay,
          padding: theme.padding.m,
        }}
      >
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <WeatherAlertModal onClose={close} onPrimaryAction={goInstructions} />
      </View>
    </>
  );
}
