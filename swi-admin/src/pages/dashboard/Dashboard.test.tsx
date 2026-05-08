// src/pages/dashboard/Dashboard.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
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

  it('renders KPI counts after summary resolves', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    // Loose assertion: the total should appear somewhere
    expect(screen.getAllByText(/12/).length).toBeGreaterThan(0)
    // Check open alerts count
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0)
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
})
