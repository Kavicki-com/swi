// src/pages/dashboard/Dashboard.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { dashboardApi, type DashboardSummary } from '@/services/mockApi'
import { Dashboard } from './Dashboard'

const FAKE_SUMMARY: DashboardSummary = {
  employees: { total: 12, byStatus: { good: 8, alert: 2, low: 1, offline: 1 } },
  alerts: {
    openOrAcknowledged: 2,
    bySeverity: { info: 0, warning: 1, critical: 1 },
  },
  kpis: { vitalSigns: 1205, wearRate: 512, urgentAlerts: 2, commonAlerts: 0 },
  recentActivities: [
    { id: 'a1', label: 'Activity 1', at: '2026-05-08T10:00:00.000Z' },
    { id: 'a2', label: 'Activity 2', at: '2026-05-08T09:00:00.000Z' },
    { id: 'a3', label: 'Activity 3', at: '2026-05-08T08:00:00.000Z' },
    { id: 'a4', label: 'Activity 4', at: '2026-05-08T07:00:00.000Z' },
    { id: 'a5', label: 'Activity 5', at: '2026-05-08T06:00:00.000Z' },
  ],
  weather: [
    { at: '2026-05-08T10:00:00.000Z', condition: 'sun', tempC: 24 },
    { at: '2026-05-08T12:00:00.000Z', condition: 'rain', tempC: 22 },
    { at: '2026-05-08T15:00:00.000Z', condition: 'storm', tempC: 19 },
  ],
}

beforeEach(() => {
  // Seed an authenticated session
  window.localStorage.setItem(
    'swi.admin.session',
    JSON.stringify({
      id: 'u_seed_1',
      org_id: 'org_seed_1',
      email: 'admin@swi.test',
      full_name: 'Admin Seed',
      role: 'super_admin',
      consent_given_at: null,
      created_at: '',
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

const renderAt = () =>
  render(
    <SwiThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Dashboard />
        </MemoryRouter>
      </AuthProvider>
    </SwiThemeProvider>,
  )

describe('Dashboard', () => {
  it('renders skeleton while loading', async () => {
    let resolveFn!: (value: { data: DashboardSummary; error: null }) => void
    const pending = new Promise<{ data: DashboardSummary; error: null }>((r) => {
      resolveFn = r
    })
    vi.spyOn(dashboardApi, 'summary').mockReturnValue(
      pending as unknown as ReturnType<typeof dashboardApi.summary>,
    )
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
    })
    resolveFn({ data: FAKE_SUMMARY, error: null })
  })

  it('renders the Figma KPI row with all five testIDs', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-good')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-alert')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-vital-signs')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-wear-rate')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-urgent-alerts')).toBeInTheDocument()
    // Mocked numbers surface
    expect(screen.getByText('1205')).toBeInTheDocument()
    expect(screen.getByText('512')).toBeInTheDocument()
    // Sublabel for urgent alerts
    expect(screen.getByText(/Necessita atenção/i)).toBeInTheDocument()
  })

  it('renders the map preview banner and navigates on CTA press', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dashboard-map-banner')).toBeInTheDocument()
    const cta = screen.getByTestId('dashboard-map-cta')
    expect(cta).toBeInTheDocument()
    // Click is wired (real navigation requires the route table; covered in routes.test.tsx)
    fireEvent.click(cta)
  })

  it('renders 5 recent activities', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    for (const a of FAKE_SUMMARY.recentActivities) {
      expect(screen.getByText(a.label)).toBeInTheDocument()
    }
  })

  it('renders 3 weather entries', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    // Each tempC should be rendered (24, 22, 19)
    expect(screen.getAllByText(/24/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/22/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/19/).length).toBeGreaterThan(0)
  })

  it('renders error panel when summary returns an error', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('form-error')).toHaveTextContent(/boom/i)
  })

  it('refetches and recovers when retry pressed', async () => {
    const spy = vi
      .spyOn(dashboardApi, 'summary')
      .mockResolvedValueOnce({ data: null, error: { message: 'transient' } })
      .mockResolvedValueOnce({ data: FAKE_SUMMARY, error: null })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-error')).toBeInTheDocument()
    })
    const retryButton = screen.getByRole('button', { name: /tentar novamente/i })
    fireEvent.click(retryButton)
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
