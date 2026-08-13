// src/app/App.tsx
//
// As telas de autenticação são importadas normalmente: são a porta de entrada,
// e adiá-las só acrescentaria uma ida ao servidor antes do login. Todas as telas
// autenticadas entram por React.lazy, cada uma no seu chunk, para que quem abre
// o /login não baixe o painel inteiro junto.
//
// O `.then` que remapeia para `default` existe porque as páginas exportam com
// nome, e React.lazy exige um módulo com export default.
import { lazy, Suspense } from 'react'
import { Routes, Route, Outlet } from 'react-router-dom'
import { View } from 'react-native'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { DemoToastProvider } from '@/lib/demoToast'
import { GlobalStyles } from './GlobalStyles'
import { GuestOnly } from './GuestOnly'
import { RequireAuth } from './RequireAuth'
import { AppLayout } from './AppLayout'
import { RouteFallback } from './RouteFallback'
import { ChatProvider } from '@/services/chat/ChatProvider'
import { Placeholder } from './Placeholder'
import { ADMIN_ROUTES, PUBLIC_PATHS } from './routes'
import { Login } from '@/pages/auth/Login'
import { SignUp } from '@/pages/auth/SignUp'
import { RecoveryEmail } from '@/pages/auth/RecoveryEmail'
import { RecoveryNewPassword } from '@/pages/auth/RecoveryNewPassword'

const Dashboard = lazy(() =>
  import('@/pages/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })),
)
const MapsGeneral = lazy(() =>
  import('@/pages/maps/MapsGeneral').then((m) => ({ default: m.MapsGeneral })),
)
const AdminsList = lazy(() =>
  import('@/pages/admins/AdminsList').then((m) => ({ default: m.AdminsList })),
)
const AdminDetails = lazy(() =>
  import('@/pages/admins/AdminDetails').then((m) => ({ default: m.AdminDetails })),
)
const EmployeesList = lazy(() =>
  import('@/pages/employees/EmployeesList').then((m) => ({ default: m.EmployeesList })),
)
const EmployeeDetails = lazy(() =>
  import('@/pages/employees/EmployeeDetails').then((m) => ({ default: m.EmployeeDetails })),
)
const ChatInbox = lazy(() =>
  import('@/pages/chat/ChatInbox').then((m) => ({ default: m.ChatInbox })),
)
const MonitoringLayout = lazy(() =>
  import('@/pages/monitoring/MonitoringLayout').then((m) => ({ default: m.MonitoringLayout })),
)
const ReportsList = lazy(() =>
  import('@/pages/reports/ReportsList').then((m) => ({ default: m.ReportsList })),
)
const ReportDetails = lazy(() =>
  import('@/pages/reports/ReportDetails').then((m) => ({ default: m.ReportDetails })),
)
const NewReport = lazy(() =>
  import('@/pages/reports/NewReport').then((m) => ({ default: m.NewReport })),
)
const ResponsablesModal = lazy(() =>
  import('@/pages/modals/ResponsablesModal').then((m) => ({ default: m.ResponsablesModal })),
)
const AlertsList = lazy(() =>
  import('@/pages/alerts/AlertsList').then((m) => ({ default: m.AlertsList })),
)
const AlertsRescueRouteSelection = lazy(() =>
  import('@/pages/alerts/AlertsRescueRouteSelection').then((m) => ({
    default: m.AlertsRescueRouteSelection,
  })),
)
const AlertsRescueRoute = lazy(() =>
  import('@/pages/alerts/AlertsRescueRoute').then((m) => ({ default: m.AlertsRescueRoute })),
)
const MonitoringAlerts = lazy(() =>
  import('@/pages/monitoring/MonitoringAlerts').then((m) => ({ default: m.MonitoringAlerts })),
)
const MonitoringGoodConditions = lazy(() =>
  import('@/pages/monitoring/MonitoringGoodConditions').then((m) => ({
    default: m.MonitoringGoodConditions,
  })),
)
const TasksList = lazy(() =>
  import('@/pages/tasks/TasksList').then((m) => ({ default: m.TasksList })),
)
const TaskForm = lazy(() => import('@/pages/tasks/TaskForm').then((m) => ({ default: m.TaskForm })))
const TaskDetails = lazy(() =>
  import('@/pages/tasks/TaskDetails').then((m) => ({ default: m.TaskDetails })),
)
const UserSettings = lazy(() =>
  import('@/pages/user/UserSettings').then((m) => ({ default: m.UserSettings })),
)
const UserProfile = lazy(() =>
  import('@/pages/user/UserProfile').then((m) => ({ default: m.UserProfile })),
)

// Uma única instância do ChatProvider pra toda a subárvore autenticada: como
// é uma rota de layout, o React Router a mantém montada ao navegar entre /chat
// (inbox) e as rotas do AppLayout (sidebar), então ambos compartilham o mesmo
// estado (conversas/mensagens). Fica ABAIXO do RequireAuth de propósito — só
// monta quando há sessão, garantindo que useAuth().user?.id já está populado e
// que o socket/REST não abrem deslogado (RequireAuth redireciona pro /login
// antes de renderizar este Outlet).
//
// O Suspense daqui cobre as rotas full-bleed (Mapas e Chat), que não têm
// chrome. As telas com sidebar suspendem na fronteira de dentro do AppLayout,
// que é a mais próxima, então lá o menu e o header ficam na tela durante a
// troca de página.
function ChatShell() {
  return (
    <ChatProvider>
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </ChatProvider>
  )
}

export function App() {
  return (
    <SwiThemeProvider>
      {/* Dentro do provider de propósito: a regra lê os tokens do tema. */}
      <GlobalStyles />
      <AuthProvider>
        <DemoToastProvider>
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
                <Route element={<ChatShell />}>
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
                      {/* Desgastados tab keeps user inside MonitoringLayout —
                       empty Outlet content; KPIs/title/tabs/userlist render
                       normally and the layout filters its userlist by tab. */}
                      <Route path="desgastados" element={<></>} />
                    </Route>
                    <Route path="/reports" element={<ReportsList />} />
                    <Route path="/reports/new" element={<NewReport />} />
                    <Route path="/reports/:id" element={<ReportDetails />} />
                    <Route path="/reports/:id/edit" element={<NewReport />} />
                    <Route path="/modals/responsables" element={<ResponsablesModal />} />
                    <Route path="/alerts" element={<AlertsList />} />
                    <Route path="/alerts/:employeeId" element={<AlertsList />} />
                    <Route
                      path="/alerts/:employeeId/rescue"
                      element={<AlertsRescueRouteSelection />}
                    />
                    <Route
                      path="/alerts/:employeeId/rescue/:rescuerId"
                      element={<AlertsRescueRoute />}
                    />
                    {/* Tarefas — /tasks/new vem antes de /tasks/:id por clareza de
                    leitura; o ranking do React Router já prioriza o segmento
                    estático sobre o dinâmico (coberto por tasksRoutes.test.tsx). */}
                    <Route path="/tasks" element={<TasksList />} />
                    <Route path="/tasks/new" element={<TaskForm />} />
                    <Route path="/tasks/:id" element={<TaskDetails />} />
                    <Route path="/tasks/:id/edit" element={<TaskForm />} />
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
              </Route>
            </Routes>
          </View>
        </DemoToastProvider>
      </AuthProvider>
    </SwiThemeProvider>
  )
}
