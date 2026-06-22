import { View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

interface VitalsErrorStateProps {
  /** Optional retry hint. The provider self-polls, so this is a UX affordance
   *  rather than the recovery mechanism. */
  onRetry?: () => void;
}

// Full-screen-ish centered error view for the vitals phase==='error'. Composes
// DS Title + Text + Button (allowed: orchestration of DS primitives). All
// spacing/colors via useTheme() — no hardcoded tokens.
export function VitalsErrorState({ onRetry }: VitalsErrorStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.background,
        gap: theme.gap.l,
        padding: theme.padding.l,
      }}
    >
      <Title variant="title.s" color={theme.content.dark} style={{ textAlign: 'center' }}>
        Não foi possível carregar
      </Title>
      <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
        Houve um problema ao buscar seus sinais vitais. Tente novamente.
      </Text>
      <Button
        variant="contained"
        label="Tentar de novo"
        elevation="lg"
        accessibilityLabel="Tentar carregar os dados de novo"
        onPress={onRetry ?? (() => {})}
      />
    </View>
  );
}
