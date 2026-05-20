import { Link, Stack } from 'expo-router';
import { Surface, Title, Text, useTheme } from '@kavicki/swi-design-system';

export default function NotFound() {
  const theme = useTheme();
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Title variant="title.m">404</Title>
        <Text variant="body.m">Tela nao encontrada.</Text>
        <Link href="/">
          <Text variant="body.s" color={theme.content.primary}>Voltar</Text>
        </Link>
      </Surface>
    </>
  );
}
