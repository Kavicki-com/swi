import { Pressable, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTheme } from '@kavicki/swi-design-system';
import {
  ResponsiblesModal,
  responsiblesSelection,
} from '../../../components/modals/ResponsiblesModal';

// Figma 364:18017 — bottom-sheet "Selecionar responsáveis".
// Route wrapper: aplica envelope `transparentModal` + backdrop pressable.
// Conteúdo real vive em `components/modals/ResponsiblesModal.tsx`.
// Aberto a partir de `reports/new.tsx` (Atribuir responsáveis). Ao
// confirmar, escreve no singleton `responsiblesSelection`; `reports/new.tsx`
// lê via `useFocusEffect` ao reentrar.
export default function ResponsiblesRoute() {
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
        <ResponsiblesModal
          onClose={close}
          onConfirm={(ids) => responsiblesSelection.set(ids)}
        />
      </View>
    </>
  );
}
