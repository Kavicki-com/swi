import { useLocalSearchParams } from 'expo-router';
import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function ChatThread() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">chat</Title>
      <Text variant="body.s">Figma 332:8580</Text>
      <Text variant="caption.s">/chat/{userId}</Text>
    </Surface>
  );
}
