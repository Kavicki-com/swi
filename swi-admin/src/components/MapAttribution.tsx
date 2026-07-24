import { Text, View } from 'react-native'
import { SATELLITE_ATTRIBUTION_LABEL } from '@/lib/mapStyles'

// Os termos dos provedores exigem atribuição onde os tiles aparecem. O
// attributionControl nativo do maplibre é desligado (caixa branca briga com o
// satélite escuro) e este label fixo entra no canto — o TEXTO vem do
// mapStyles, acompanhando o provider ativo (Mapbox com token; Esri no
// fallback). Cor hardcoded branca de propósito: os tiles são sempre escuros e
// tokens de tema inverteriam no light mode.
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
        {SATELLITE_ATTRIBUTION_LABEL}
      </Text>
    </View>
  )
}
