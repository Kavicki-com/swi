import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function ChatInbox() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">chat-inbox</Title>
      <Text variant="body.s">Figma 336:8808</Text>
      <Text variant="caption.s">/chat/inbox</Text>
    </Surface>
  );
}
