import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, useTheme } from '@kavicki/swi-design-system';
import { HomeFAB } from './HomeFAB';

// Bottom-edge dual FAB cluster used on ~9 (app) screens (map, evacuation,
// evacuation-ongoing, dashboard alert-active, notifications, journey/*,
// reports/index). Two pill buttons absolute-positioned over the screen
// content:
//   - Chat (right, surface.success)  -> /(app)/chat/inbox
//   - Home (centered, DS Button FAB via HomeFAB) -> /(app)/dashboard
// Both pinned near the bottom so the safe area never clips them on devices
// with a home indicator.
//
// Props:
//   - `onChatPress` / `onHomePress`: override the default navigation. Default
//     handlers push the canonical routes above.
//   - `showHome` / `showChat`: render the respective FAB. Both default true.

// Offset do Chat FAB a partir da borda inferior segura e sua altura aproximada
// (Button size="large": padding.m*2 + ícone 25,714 + borda ~= 61,7). O Chat é
// o FAB mais alto, então o topo do cluster fica em CHAT_FAB_BOTTOM +
// CHAT_FAB_HEIGHT acima da safe area. A barra de confirmação da evacuação usa
// NAV_FABS_HEIGHT para flutuar acima do cluster sem sobrepor os FABs.
const CHAT_FAB_BOTTOM = 71;
const CHAT_FAB_HEIGHT = 62;
export const NAV_FABS_HEIGHT = CHAT_FAB_BOTTOM + CHAT_FAB_HEIGHT;

// Home FAB um pouco mais perto da borda que o Chat.
const HOME_FAB_BOTTOM = 24;

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
  // navigate() é "smart": se /(app)/dashboard já está no stack (caso normal,
  // dashboard é a root do (app)), faz pop até ela em vez de montar uma nova
  // instância. Resolve o atraso percebido ao tocar o Home FAB de outras telas
  // (o fundo de expo-image remontava toda vez, da ordem de centenas de ms).
  // Com navigate, é instantâneo no caso comum.
  const handleHome = onHomePress ?? (() => router.navigate('/(app)/dashboard'));

  return (
    <>
      {showChat ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            // right edge a 36 do viewport (frame 360, left=264, width 60).
            bottom: insets.bottom + CHAT_FAB_BOTTOM,
            right: 36,
          }}
        >
          <Button
            variant="contained"
            shape="pill"
            size="large"
            backgroundColor={theme.surface.success}
            elevation="lg"
            iconLeft={
              <Icon
                name="chat_bubble"
                width={25.714}
                height={25.714}
                // content.dark = #F5F5F5 (branco). content.light resolvia para
                // #222 (escuro) no tema escuro.
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
            bottom: insets.bottom + HOME_FAB_BOTTOM,
            left: 0,
            right: 0,
            alignItems: 'center',
          }}
        >
          <HomeFAB onPress={handleHome} />
        </View>
      ) : null}
    </>
  );
}
