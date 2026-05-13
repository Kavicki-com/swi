import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function ChatUserInfo() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">chat-user-info</Title>
      <Text variant="body.s">Figma 336:8891 (drawer 288px)</Text>
      <Text variant="caption.s">/chat/user-info</Text>
    </Surface>
  );
}
