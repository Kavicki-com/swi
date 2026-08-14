import { useEffect } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Única tela do Expo web no build de release. O produto web suportado é o
// painel administrativo; o app web sempre foi ferramenta de desenvolvimento e
// mantém.
//
// Renderizado por app/_layout.tsx ANTES de qualquer provider: sem
// AuthProvider, sem Stack, sem sampler de telemetria e sem heartbeat de
// posição. Não é uma tela do app que esconde as outras, é o lugar onde o app
// não é montado.
//
// Não reaproveita o ProdOnlyPlaceholder porque aquele tem botão de voltar que
// chama o router, e aqui o Stack do expo-router não existe.
export function WebPanelNotice() {
  const theme = useTheme();

  // O _layout chama preventAutoHideAsync no topo do módulo. Neste ramo nada
  // mais chega ao hideAsync, então sem isto a splash ficaria para sempre.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.padding.m,
        gap: theme.gap.m,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.surface.medium,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="build" size={36} color={theme.content.dark} />
      </View>

      <Title variant="title.s" color={theme.content.dark} style={{ textAlign: 'center' }}>
        Acesse pelo painel
      </Title>

      <Text
        variant="body.m"
        color={theme.content.medium}
        style={{ textAlign: 'center', maxWidth: 360 }}
      >
        O SWI no navegador funciona pelo painel administrativo. Este endereço serve o
        aplicativo, que é distribuído para Android.
      </Text>
    </View>
  );
}
