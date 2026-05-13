import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function NewReport() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">new-report</Title>
      <Text variant="body.s">Figma 372:21297</Text>
      <Text variant="caption.s">/reports/new</Text>
    </Surface>
  );
}
