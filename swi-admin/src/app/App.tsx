import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { View } from 'react-native'

export function App() {
  return (
    <SwiThemeProvider>
      <View testID="app-root" />
    </SwiThemeProvider>
  )
}
