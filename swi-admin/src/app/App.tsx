// src/app/App.tsx
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { Routes, Route } from 'react-router-dom'
import { View } from 'react-native'
import { AuthProvider } from '@/hooks/useAuth'
import { ADMIN_ROUTES } from './routes'
import { Placeholder } from './Placeholder'

export function App() {
  return (
    <SwiThemeProvider>
      <AuthProvider>
        <View testID="app-root">
          <Routes>
            {ADMIN_ROUTES.map((r) => (
              <Route
                key={r.path}
                path={r.path}
                element={<Placeholder label={r.label} />}
              />
            ))}
          </Routes>
        </View>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
