import { useLocalSearchParams } from 'expo-router';
import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function TaskDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">task-details</Title>
      <Text variant="body.s">Figma 364:17126 / 364:17434</Text>
      <Text variant="caption.s">/journey/task/{id}</Text>
    </Surface>
  );
}
