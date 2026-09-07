import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function EmailSent() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">email-confirmation-message</Title>
      <Text variant="body.s">Figma 211:12920 / 290:688</Text>
      <Text variant="caption.s">/(auth)/email-sent</Text>
    </Surface>
  );
}
