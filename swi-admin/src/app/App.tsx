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
import { MapsGeneral } from '@/pages/maps/MapsGeneral'
import { AdminsList } from '@/pages/admins/AdminsList'
import { AdminDetails } from '@/pages/admins/AdminDetails'
import { EmployeesList } from '@/pages/employees/EmployeesList'
import { EmployeeDetails } from '@/pages/employees/EmployeeDetails'
import { ChatInbox } from '@/pages/chat/ChatInbox'
import { MonitoringLayout } from '@/pages/monitoring/MonitoringLayout'
import { ReportsList } from '@/pages/reports/ReportsList'
import { ReportDetails } from '@/pages/reports/ReportDetails'
import { NewReport } from '@/pages/reports/NewReport'
import { ResponsablesModal } from '@/pages/modals/ResponsablesModal'
import { AlertsList } from '@/pages/alerts/AlertsList'
import { AlertsRescueRouteSelection } from '@/pages/alerts/AlertsRescueRouteSelection'
import { AlertsRescueRoute } from '@/pages/alerts/AlertsRescueRoute'
import { MonitoringAlerts } from '@/pages/monitoring/MonitoringAlerts'
import { MonitoringGoodConditions } from '@/pages/monitoring/MonitoringGoodConditions'
import { UserSettings } from '@/pages/user/UserSettings'
import { UserProfile } from '@/pages/user/UserProfile'
import { FidelityReview } from '@/dev/fidelity/FidelityReview'

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
              {import.meta.env.DEV && <Route path="/dev/fidelity" element={<FidelityReview />} />}
              {/* Full-bleed routes (no AppLayout sidebar/header) — Maps live here. */}
              <Route path="/maps/general" element={<MapsGeneral />} />
              <Route path="/chat" element={<ChatInbox />} />
              <Route path="/chat/:contactId" element={<ChatInbox />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/admins" element={<AdminsList />} />
                <Route path="/admins/new" element={<AdminsList initialTab="cadastrar" />} />
                <Route path="/admins/:id" element={<AdminDetails />} />
                <Route path="/employees" element={<EmployeesList />} />
                <Route
                  path="/employees/new"
                  element={<EmployeesList initialTab="cadastrar" />}
                />
                <Route path="/employees/:id" element={<EmployeeDetails />} />
                {/* /monitoring/* is a nested layout: MonitoringLayout owns
                    KPIs/title/tabs/search/userlist; child views render the
                    unique row that goes between KPIs and title. */}
                <Route path="/monitoring" element={<MonitoringLayout />}>
                  <Route path="alerts" element={<MonitoringAlerts />} />
                  <Route path="good-conditions" element={<MonitoringGoodConditions />} />
                </Route>
                <Route path="/reports" element={<ReportsList />} />
                <Route path="/reports/new" element={<NewReport />} />
                <Route path="/reports/:id" element={<ReportDetails />} />
                <Route path="/modals/responsables" element={<ResponsablesModal />} />
                <Route path="/alerts" element={<AlertsList />} />
                <Route path="/alerts/:employeeId" element={<AlertsList />} />
                <Route path="/alerts/:employeeId/rescue" element={<AlertsRescueRouteSelection />} />
                <Route
                  path="/alerts/:employeeId/rescue/:rescuerId"
                  element={<AlertsRescueRoute />}
                />
                <Route path="/user/settings" element={<UserSettings />} />
                <Route path="/user/profile" element={<UserProfile />} />
                {ADMIN_ROUTES.filter(
                  (r) =>
                    !PUBLIC_PATHS.has(r.path) &&
                    r.path !== '/' &&
                    r.path !== '/admins' &&
                    r.path !== '/admins/new' &&
                    r.path !== '/admins/:id' &&
                    r.path !== '/maps/general' &&
                    r.path !== '/user/settings' &&
                    r.path !== '/user/profile' &&
                    r.path !== '/employees' &&
                    r.path !== '/employees/new' &&
                    r.path !== '/employees/:id' &&
                    r.path !== '/chat' &&
                    r.path !== '/monitoring/alerts' &&
                    r.path !== '/monitoring/good-conditions' &&
                    r.path !== '/reports' &&
                    r.path !== '/reports/:id' &&
                    r.path !== '/reports/new' &&
                    r.path !== '/modals/responsables' &&
                    r.path !== '/alerts' &&
                    r.path !== '/alerts/:employeeId' &&
                    r.path !== '/alerts/:employeeId/rescue' &&
                    r.path !== '/alerts/:employeeId/rescue/:rescuerId',
                ).map((r) => (
                  <Route key={r.path} path={r.path} element={<Placeholder label={r.label} />} />
                ))}
              </Route>
            </Route>
          </Routes>
        </View>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
