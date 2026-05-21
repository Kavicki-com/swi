import { Stack } from 'expo-router';

export default function ReportsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Sub-rotas index / new / [id] usam defaults — full-screen push. */}
      {/* `responsibles` é uma bottom-sheet sobre reports/new, não uma sub-tela.
          `presentation` precisa ser registrado AQUI no layout pai — setar via
          <Stack.Screen options> inline dentro do screen funciona pra opções
          dinâmicas mas `presentation` é resolvido NO MOMENTO DA NAVEGAÇÃO,
          antes do screen montar. Mesmo pattern de settings/support. */}
      <Stack.Screen
        name="responsibles"
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
