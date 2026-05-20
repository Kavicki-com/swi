import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@kavicki/swi-design-system';
import { PrivacyPolicyModal } from '../../../components/modals/PrivacyPolicyModal';

// Figma 348:10434 — bottom-sheet "Política de privacidade" (authenticated).
// Route wrapper: aplica envelope `transparentModal` + backdrop pressable.
// Conteúdo real vive em `components/modals/PrivacyPolicyModal.tsx`.
export default function SettingsPrivacy() {
  const router = useRouter();
  const theme = useTheme();
  const close = () => router.back();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />

      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlay }}>
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />
        <PrivacyPolicyModal onClose={close} />
      </View>
    </>
  );
}
