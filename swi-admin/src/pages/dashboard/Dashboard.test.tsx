// src/pages/dashboard/Dashboard.test.tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { dashboardApi, type DashboardSummary } from '@/services/mockApi/dashboard'
import { Dashboard } from './Dashboard'

const FAKE_SUMMARY: DashboardSummary = {
  employees: { total: 12, byStatus: { good: 8, alert: 2, low: 1, offline: 1 } },
  alerts: {
    openOrAcknowledged: 2,
    bySeverity: { info: 0, warning: 1, critical: 1 },
  },
  kpis: {
    admins: 3,
    totalEmployees: 1205,
    newReports: 4,
    activeCameras: 564,
    vitalSigns: 512,
    wearRate: 512,
    urgentAlerts: 2,
    commonAlerts: 0,
  },
  mapMarkers: [{ id: 'e1', name: 'A', lat: -23.55, lng: -46.63, status: 'good', avatarUri: 'x' }],
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
  // All on the same tier so the existing assertions (which render the
  // default tab without interacting with the filter) still see all three.
  // Tab-filtering behavior is covered separately by the inflated demo
  // fixture in mockApi/dashboard.ts.
  wearAlerts: [
    {
      id: 'w1',
      employeeName: 'Ezequiel Almeida',
      sector: 'Setor Leste',
      progress: 88,
      bpm: 138,
      pressure: '16/10',
      tier: 'alerta-fadiga',
    },
    {
      id: 'w2',
      employeeName: 'Mariana Costa',
      sector: 'Setor Leste',
      progress: 85,
      bpm: 134,
      pressure: '15/10',
      tier: 'alerta-fadiga',
    },
    {
      id: 'w3',
      employeeName: 'Rafael Souza',
      sector: 'Setor Norte',
      progress: 91,
      bpm: 142,
      pressure: '17/11',
      tier: 'alerta-fadiga',
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

  it('renders the Figma KPI row: 2x2 Funcionários grid + 3 donuts', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument()
    // 2x2 grid in Funcionarios composite — 4 separate tiles
    expect(screen.getByTestId('kpi-funcionarios')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-admins')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-employees')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-reports')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-funcionarios-cameras')).toBeInTheDocument()
    // 3 DonutCharts on the right side of the row
    expect(screen.getByTestId('kpi-vital-signs')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-wear-rate')).toBeInTheDocument()
    expect(screen.getByTestId('kpi-urgent-alerts')).toBeInTheDocument()
    // Mocked numbers surface in the rendered output.
    expect(screen.getByText('1205')).toBeInTheDocument()
    expect(screen.getByText('564')).toBeInTheDocument()
    // 512 is shared by Sinais vitais and Taxa de desgaste donuts.
    expect(screen.getAllByText('512').length).toBeGreaterThanOrEqual(2)
    // Caption from the Alertas urgentes donut.
    expect(screen.getByText(/Necessária mobilização/i)).toBeInTheDocument()
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
    expect(screen.getByTestId('dashboard-map-canvas')).toBeInTheDocument()
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
    const tabs = screen.getByTestId('activities-tabs')
    fireEvent.click(within(tabs).getByText('A Fazer'))
    await waitFor(() => {
      expect(screen.getByTestId('activity-a3')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('activity-a1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('activities-see-all'))
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

  // Responsive system tests — one per breakpoint class.
  //
  // See AppLayout.test.tsx for the rationale: react-native-web's Dimensions
  // reads documentElement.clientWidth, so we override the getter per-test.
  describe('breakpoints', () => {
    const setViewportWidth = (w: number) => {
      Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        get: () => w,
      })
      Object.defineProperty(document.documentElement, 'clientHeight', {
        configurable: true,
        get: () => 900,
      })
      window.dispatchEvent(new Event('resize'))
    }

    afterEach(() => {
      // Restore the desktop default for subsequent tests.
      setViewportWidth(1366)
    })

    it('renders the tablet single-column top row when width < 1024', async () => {
      setViewportWidth(800)
      vi.spyOn(dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
      renderAt()
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
      })
      expect(screen.getByTestId('dashboard-top-row-tablet')).toBeInTheDocument()
      expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-top-row-wide')).not.toBeInTheDocument()
    })

    it('renders the existing desktop kpi-row when 1024 ≤ width < 1600', async () => {
      setViewportWidth(1366)
      vi.spyOn(dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
      renderAt()
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
      })
      expect(screen.getByTestId('kpi-row')).toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-top-row-tablet')).not.toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-top-row-wide')).not.toBeInTheDocument()
    })

    it('renders the wide top-row (Map | Charts | KPIs) when width >= 1600', async () => {
      setViewportWidth(1920)
      vi.spyOn(dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
      renderAt()
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
      })
      expect(screen.getByTestId('dashboard-top-row-wide')).toBeInTheDocument()
      expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-top-row-tablet')).not.toBeInTheDocument()
    })
  })
})
