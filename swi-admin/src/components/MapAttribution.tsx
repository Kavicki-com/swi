import { Text, View } from 'react-native'

// Mapbox + OpenStreetMap terms require attribution wherever their tiles are
// shown. We disable maplibre's built-in attributionControl (it injects a white
// box that fights the dark satellite imagery) and render a small, fixed,
// non-interactive label in the bottom-right corner instead. Color is
// intentionally hard-coded white over the always-dark satellite tiles —
// theme tokens would invert in dark/light mode and break contrast.
export function MapAttribution() {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 8, bottom: 8, zIndex: 1 }}>
      <Text
        style={{
          fontSize: 11,
          color: '#ffffff',
          textShadowColor: 'rgba(0,0,0,0.8)',
          textShadowRadius: 3,
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        © Mapbox © OpenStreetMap
      </Text>
    </View>
  )
}
