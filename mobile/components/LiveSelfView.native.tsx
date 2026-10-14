import { Pressable, StyleSheet, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, useTheme } from '@kavicki/swi-design-system';
import { useLiveBroadcast } from '../services/live/useLiveBroadcast';

// Self-view do worker: uma miniatura flutuante da própria câmera enquanto a
// transmissão está no ar, sobre qualquer tela (montada no layout autenticado,
// como a transmissão, que segue em qualquer tela). Toque encerra. Só-nativo: a
// web não tem câmera (ver LiveSelfView.tsx).
export function LiveSelfView() {
  // O gancho do store fica no componente externo; os ganchos de tema e área
  // segura ficam no interno, montado só quando há o que mostrar.
  const { broadcasting, previewUrl, toggle } = useLiveBroadcast();
  if (!broadcasting || !previewUrl) return null;
  return <SelfViewThumb previewUrl={previewUrl} onStop={toggle} />;
}

function SelfViewThumb({ previewUrl, onStop }: { previewUrl: string; onStop: () => void }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Encerrar transmissão da câmera"
      onPress={onStop}
      style={{
        position: 'absolute',
        top: insets.top + theme.gap.s,
        left: theme.padding.m,
        width: 112,
        height: 84,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        backgroundColor: theme.surface.medium,
        borderWidth: 2,
        borderColor: theme.surface.danger,
        elevation: 6,
      }}
    >
      <RTCView streamURL={previewUrl} objectFit="cover" style={StyleSheet.absoluteFill} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: theme.border.radius.pill,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }}
      >
        <View
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.surface.danger }}
        />
        <Text variant="caption.s" color={theme.content.light}>
          AO VIVO
        </Text>
      </View>
    </Pressable>
  );
}
