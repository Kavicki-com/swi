import { Surface, Title, Text } from '@kavicki/swi-design-system';

export default function MyStats() {
  return (
    <Surface variant="standard" padding="m" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Title variant="title.m">my-stats</Title>
      <Text variant="body.s">Figma 342:9419 - heart-rate-button no dashboard</Text>
      <Text variant="caption.s">/my-stats</Text>
    </Surface>
  );
}
