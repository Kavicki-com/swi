import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@kavicki/swi-design-system';
import { SupportFormModal } from '../../../components/modals/SupportFormModal';

// Figma 348:10426 — bottom-sheet "Solicitação de suporte" (authenticated).
// Route wrapper: aplica envelope `transparentModal` + backdrop pressable.
// Conteúdo real vive em `components/modals/SupportFormModal.tsx`.
export default function SettingsSupport() {
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
        {/* Backdrop — clicar fecha modal */}
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />
        <SupportFormModal onClose={close} />
      </View>
    </>
  );
}
