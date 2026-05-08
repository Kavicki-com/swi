// src/app/App.tsx
import { Routes, Route } from 'react-router-dom'
import { View } from 'react-native'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { GuestOnly } from './GuestOnly'
import { RequireAuth } from './RequireAuth'
import { AppLayout } from './AppLayout'
import { Placeholder } from './Placeholder'
import { ADMIN_ROUTES, PUBLIC_PATHS } from './routes'
import { Login } from '@/pages/auth/Login'
import { SignUp } from '@/pages/auth/SignUp'
import { RecoveryEmail } from '@/pages/auth/RecoveryEmail'
import { RecoveryNewPassword } from '@/pages/auth/RecoveryNewPassword'
import { Dashboard } from '@/pages/dashboard/Dashboard'

export function App() {
  return (
    <SwiThemeProvider>
      <AuthProvider>
        <View testID="app-root">
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<Login />} />
              {/* recovery routes wired in their own tasks. For now,
                  fall back to placeholder so deep-links don't 404. */}
              <Route path="/sign-up" element={<SignUp />} />
              <Route path="/recovery/email" element={<RecoveryEmail />} />
              <Route path="/recovery/new-password" element={<RecoveryNewPassword />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                {ADMIN_ROUTES.filter((r) => !PUBLIC_PATHS.has(r.path) && r.path !== '/').map(
                  (r) => (
                    <Route key={r.path} path={r.path} element={<Placeholder label={r.label} />} />
                  ),
                )}
              </Route>
            </Route>
          </Routes>
        </View>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
