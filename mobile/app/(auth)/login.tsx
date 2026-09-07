import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function Login() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">login</Title>
      <Text variant="body.s">Figma 138:7937</Text>
      <Text variant="caption.s">/(auth)/login</Text>
    </Surface>
  );
}
