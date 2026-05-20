import { View } from 'react-native';
import { Text, useTheme } from '@kavicki/swi-design-system';

// Theme-aware text chip used as a <MapMarker> child for the evacuation
// route time labels ("6 minutos", "17 minutos", etc.). Must be rendered
// inside a <SwiThemeProvider> on web — the maplibre-gl marker bridge
// mounts children into a detached React root that does not inherit the
// app theme context. On native the theme context flows naturally so the
// wrap is a no-op (idempotent, safer-by-default).
//
// Previously duplicated verbatim in evacuation.tsx and evacuation-ongoing.tsx
// (~16 lines each). Extracted per the audit cleanup in
// 2026-05-17-mobile-routes-audit.md.

export interface MapChipBodyProps {
  text: string;
}

export function MapChipBody({ text }: MapChipBodyProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.background,
        paddingHorizontal: theme.padding.xs,
        paddingVertical: theme.padding.xs,
        borderRadius: theme.border.radius.s,
      }}
    >
      <Text variant="body.s" color={theme.content.dark}>
        {text}
      </Text>
    </View>
  );
}
