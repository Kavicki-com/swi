import { useLocalSearchParams } from 'expo-router';
import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function ReportDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">report-details</Title>
      <Text variant="body.s">Figma 364:20304</Text>
      <Text variant="caption.s">/reports/{id}</Text>
    </Surface>
  );
}
