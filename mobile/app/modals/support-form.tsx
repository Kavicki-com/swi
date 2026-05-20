import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@kavicki/swi-design-system';
import { SupportFormModal } from '../../components/modals/SupportFormModal';

// Figma 213:13742 / 348:10426 — bottom-sheet "Solicitação de suporte".
// Pre-auth route (acessível da tela de login). Body real vive em
// `components/modals/SupportFormModal.tsx`. O wrapper aplica
// transparentModal + backdrop pressable, sobreescrevendo o
// `presentation: 'modal'` registrado no root `_layout.tsx`.
export default function SupportFormModalRoute() {
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
        <SupportFormModal onClose={close} />
      </View>
    </>
  );
}
