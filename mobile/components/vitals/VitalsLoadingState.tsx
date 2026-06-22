import { ActivityIndicator, View } from 'react-native';
import { Text, useTheme } from '@kavicki/swi-design-system';

// Full-screen-ish centered loading view for the vitals phase==='loading'.
// Composes the RN ActivityIndicator (no DS spinner primitive exists) + DS Text.
// All spacing/colors via useTheme() — no hardcoded tokens.
export function VitalsLoadingState() {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.background,
        gap: theme.gap.m,
        padding: theme.padding.l,
      }}
    >
      <ActivityIndicator size="large" color={theme.content.primary} />
      <Text variant="body.m" color={theme.content.dark}>
        Carregando seus dados…
      </Text>
    </View>
  );
}
