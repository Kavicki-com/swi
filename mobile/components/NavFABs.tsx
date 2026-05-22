import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, useTheme } from '@kavicki/swi-design-system';
import { HomeFAB } from './HomeFAB';

// Bottom-edge dual FAB cluster used on ~9 (app) screens (map, evacuation,
// evacuation-ongoing, dashboard alert-active, notifications, journey/*,
// reports/index). Two pill buttons absolute-positioned over the screen
// content:
//   - Chat (right, surface.success)  → /(app)/chat/inbox
//   - Home (centered, content.dark + content.disable ring) → /(app)/dashboard
// Both pinned at insets.bottom + theme.gap.l from the bottom edge so the
// safe area never clips them on devices with a home indicator.
//
// Props:
//   - `onChatPress` / `onHomePress`: override the default navigation. Default
//     handlers push the canonical routes above.
//   - `showHome` / `showChat`: render the respective FAB. Both default true.

export interface NavFABsProps {
  onChatPress?: () => void;
  onHomePress?: () => void;
  showHome?: boolean;
  showChat?: boolean;
}

export function NavFABs({
  onChatPress,
  onHomePress,
  showHome = true,
  showChat = true,
}: NavFABsProps) {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleChat = onChatPress ?? (() => router.push('/(app)/chat/inbox'));
  const handleHome = onHomePress ?? (() => router.push('/(app)/dashboard'));

  return (
    <>
      {showChat ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            // Figma 364:16378 — chat FAB top=669 em frame 800 → bottom ~71;
            // right edge a 36 do viewport (frame 360, left=264, width 60).
            bottom: insets.bottom + 71,
            right: 36,
          }}
        >
          <Button
            variant="contained"
            shape="pill"
            // Figma standalone (364:16775): padding 16 + icon container 24
            // → 56×56 total. Antes "xlarge" (padding ml=20) gerava 68×68.
            size="large"
            backgroundColor={theme.surface.success}
            elevation="lg"
            iconLeft={
              <Icon
                name="chat_bubble"
                // Figma 364:16378 journey-context: 25.714×25.714.
                width={25.714}
                height={25.714}
                // content.dark = #F5F5F5 (white). content.light resolvia
                // pra #222 (dark) em dark mode — usuário detectou.
                color={theme.content.dark}
              />
            }
            accessibilityLabel="Abrir chat"
            onPress={handleChat}
          />
        </View>
      ) : null}

      {showHome ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            // Figma 364:16378 — home FAB bottom 23.57px (Figma) → 24.
            bottom: insets.bottom + 24,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          {/* HomeFAB renderiza o SVG fiel ao Figma 348:10334 (círculo
              71.43×71.43 com anel interno 10.286pt). Antes usávamos
              <Button variant="contained" shape="pill" border 10pt> do DS,
              que gerava ~92×92 com borda EXTERNA — usuário reportou
              divergência visual ("feio, não segue o Figma"). */}
          <HomeFAB onPress={handleHome} />
        </View>
      ) : null}
    </>
  );
}
