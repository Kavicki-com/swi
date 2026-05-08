// src/app/Placeholder.tsx
import { View, Text } from 'react-native'

export function Placeholder({ label }: { label: string }) {
  return (
    <View testID={`placeholder-${label}`} style={{ padding: 24 }}>
      <Text>Em construção: {label}</Text>
    </View>
  )
}
