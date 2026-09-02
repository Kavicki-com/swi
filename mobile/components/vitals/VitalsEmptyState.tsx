import { View } from 'react-native';
import { SmartbandStatus, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Full-screen-ish centered empty view for the vitals phase==='empty' (the
// backend reported no readings yet). Composes DS Title + Text + SmartbandStatus
// (allowed: this orchestrates DS primitives, it doesn't replace any).
//
// SmartbandStatus props fit cleanly (see SmartbandStatus.types.ts): progress 0..1
// drives the bar, heartRate/bloodPressure=null render the `/` placeholder, and
// `message` conveys the "ative o monitoramento" prompt, so it's used as-is.
export function VitalsEmptyState() {
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
        Sem leituras ainda
      </Title>
      <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
        Ative o monitoramento do seu Apple Watch para acompanhar seus sinais vitais.
      </Text>
      <View style={{ width: '100%' }}>
        <SmartbandStatus
          progress={0}
          heartRate={null}
          bloodPressure={null}
          message="Monitoramento inativo"
          accessibilityLabel="Ative o monitoramento do seu Apple Watch para acompanhar seus sinais vitais"
        />
      </View>
    </View>
  );
}
