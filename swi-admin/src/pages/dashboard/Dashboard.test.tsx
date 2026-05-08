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
  activities: [
    {
      id: 'a1',
      title: 'Reparo',
      sector: 'Setor Leste',
      status: 'em-curso',
      progress: 50,
      participants: [{ uri: 'x', alt: 'A' }],
    },
    {
      id: 'a2',
      title: 'Reparo Norte',
      sector: 'Setor Norte',
      status: 'em-curso',
      progress: 30,
      participants: [],
    },
    {
      id: 'a3',
      title: 'Aluguel maquinário',
      sector: 'Setor Leste',
      status: 'a-fazer',
      progress: 0,
      participants: [],
    },
    {
      id: 'a4',
      title: 'Reparo Sul',
      sector: 'Setor Sul',
      status: 'concluida',
      progress: 100,
      participants: [],
    },
  ],
  wearAlerts: [
    {
      id: 'w1',
      employeeName: 'Ezequiel Almeida',
      sector: 'Setor Leste',
      progress: 70,
      bpm: 110,
      pressure: '14/9',
    },
    {
      id: 'w2',
      employeeName: 'Mariana Costa',
      sector: 'Setor Leste',
      progress: 65,
      bpm: 104,
      pressure: '13/8',
    },
    {
      id: 'w3',
      employeeName: 'Rafael Souza',
      sector: 'Setor Norte',
      progress: 80,
      bpm: 118,
      pressure: '15/9',
    },
  ],
  weather: [
    { at: '2026-05-08T08:00:00.000Z', condition: 'rain', tempC: 22, label: 'CHUVAS\nMODERADAS' },
    { at: '2026-05-08T10:00:00.000Z', condition: 'sun', tempC: 26, label: 'SOL\nINTENSO' },
    {
      at: '2026-05-08T12:00:00.000Z',
      condition: 'sun',
      tempC: 25,
      label: 'AGORA',
      isNow: true,
    },
    { at: '2026-05-08T14:00:00.000Z', condition: 'rain', tempC: 23, label: 'CHUVAS\nMODERADAS' },
    {
      at: '2026-05-08T16:00:00.000Z',
      condition: 'storm',
      tempC: 21,
      label: 'PARCIALMENTE\nNUBLADO',
    },
    { at: '2026-05-08T18:00:00.000Z', condition: 'sun', tempC: 24, label: 'SOL' },
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

  it('renders only "Em Curso" activities by default', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('activities-section')).toBeInTheDocument()
    })
    // The two em-curso activities render
    expect(screen.getByTestId('activity-a1')).toBeInTheDocument()
    expect(screen.getByTestId('activity-a2')).toBeInTheDocument()
    // The a-fazer + concluida ones are filtered out
    expect(screen.queryByTestId('activity-a3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('activity-a4')).not.toBeInTheDocument()
  })

  it('renders the wear alerts column with all employees and the two-column row', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('wear-alerts-section')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dashboard-two-col-row')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w1')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w2')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w3')).toBeInTheDocument()
  })

  it('filters wear alerts via the SearchInput', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('wear-alerts-section')).toBeInTheDocument()
    })
    const searchInput = screen.getByPlaceholderText(/Pesquisar Funcion/i)
    fireEvent.change(searchInput, { target: { value: 'Mariana' } })
    await waitFor(() => {
      expect(screen.getByTestId('wear-alert-w2')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('wear-alert-w1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wear-alert-w3')).not.toBeInTheDocument()
  })

  it('switches the activity filter when a chip is pressed', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('activities-section')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('A Fazer'))
    await waitFor(() => {
      expect(screen.getByTestId('activity-a3')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-a1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Ver Todas'))
    await waitFor(() => {
      expect(screen.getByTestId('activity-a4')).toBeInTheDocument()
    })
    expect(screen.getByTestId('activity-a1')).toBeInTheDocument()
  })

  it('renders the expanded WeatherTimeline with the AGORA marker', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('weather-timeline')).toBeInTheDocument()
    })
    // AGORA appears at least once — the event label and/or the now-marker overlay
    expect(screen.getAllByText('AGORA').length).toBeGreaterThan(0)
    // SOL INTENSO and PARCIALMENTE NUBLADO labels appear (newline-separated)
    expect(screen.getAllByText(/SOL/).length).toBeGreaterThan(0)
    expect(screen.getByText(/PARCIALMENTE/)).toBeInTheDocument()
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
