import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Sub-routes (index, faq, change-password, health-data, personal-data,
          preferences, privacy) usam defaults do Stack — full-screen push. */}
      {/* `support` é uma bottom-sheet sobre as settings, não uma sub-tela.
          Setando aqui no layout pra que o Expo Router aplique a transição
          modal logo na navegação. Setar via <Stack.Screen options> inline
          dentro do screen funciona pra options dinâmicos mas `presentation`
          é resolvido NO MOMENTO DA NAVEGAÇÃO, antes do screen montar — daí
          a necessidade de registrar aqui. */}
      <Stack.Screen
        name="support"
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />
      {/* `privacy` segue o mesmo padrão de `support`: bottom-sheet sobre
          settings, NÃO tela full-screen. Mesma motivação do comment acima —
          `presentation` precisa ser resolvido no layout, não inline no
          screen, senão o Expo Router aplica push default e a sheet abre
          como tela. (Figma 348:10434.) */}
      <Stack.Screen
        name="privacy"
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
