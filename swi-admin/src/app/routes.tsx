// src/app/routes.tsx
export const ADMIN_ROUTES = [
  // auth
  { path: '/login', label: 'login' },
  { path: '/sign-up', label: 'sign-up' },
  { path: '/recovery/email', label: 'password-recovery-email' },
  { path: '/recovery/new-password', label: 'password-recovery-newpassword' },
  // core
  { path: '/', label: 'dashboard' },
  // admins
  { path: '/admins', label: 'admins' },
  { path: '/admins/new', label: 'admin-registration' },
  { path: '/admins/:id', label: 'admin-details' },
  // employees
  { path: '/employees', label: 'employees' },
  { path: '/employees/new', label: 'employee-registration' },
  { path: '/employees/:id', label: 'employee-details' },
  // maps
  { path: '/maps/general', label: 'map-view-general' },
  { path: '/maps/cameras', label: 'map-view-cameras' },
  { path: '/maps/heat', label: 'map-view-heat' },
  { path: '/maps/meteorologic', label: 'map-metereologic-alerts' },
  // alerts
  { path: '/alerts', label: 'alerts' },
  { path: '/alerts/heatmap', label: 'alerts-heatmap' },
  { path: '/alerts/meteorologic', label: 'alerts-metereologic-map' },
  { path: '/alerts/:id/rescue-route', label: 'alerts-rescue-route' },
  { path: '/alerts/:id/rescue-route/select', label: 'alerts-rescue-route-selection' },
  { path: '/alerts/:id/rescue-ongoing', label: 'alerts-rescue-ongoing' },
  // monitoring
  { path: '/monitoring/alerts', label: 'monitoring-alerts' },
  { path: '/monitoring/good-conditions', label: 'monitoring-good-conditions' },
  // reports
  { path: '/reports', label: 'reports' },
  { path: '/reports/new', label: 'new-report' },
  { path: '/reports/:id', label: 'report-details' },
  // chat
  { path: '/chat', label: 'chat-inbox' },
  // user
  { path: '/user/settings', label: 'user-settings' },
  { path: '/user/profile', label: 'user-profile' },
  // modals (rendered as routes for now; promoted to overlays in S5)
  { path: '/modals/support', label: 'support-form-modal' },
  { path: '/modals/privacy', label: 'privacy-policy-modal' },
  { path: '/modals/responsables', label: 'responsables-modal' },
] as const

export type AdminRoute = (typeof ADMIN_ROUTES)[number]
