// src/pages/dashboard/Dashboard.test.tsx
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import { AuthProvider } from '@/hooks/useAuth'
import { SESSION_STORAGE_KEY, TOKEN_STORAGE_KEY } from '@/services/api/http'
import { dashboardApi, type DashboardSummary } from '@/services/dashboard'
import { Dashboard } from './Dashboard'
import { settled } from '@/test-utils/renderPage'
import type { AdminTelemetrySummary, AdminWorkersTelemetry } from '@/services/api/telemetry'
import {
  adminSummary,
  adminWorker,
  condition,
  neverReported,
  noMetric,
  reporting,
} from '@/test-utils/telemetryFixtures'

// Posições live têm suite própria (useLivePositions.test); aqui devolvemos os
// markers do fixture direto pra não abrir fetch/socket reais no jsdom.
vi.mock('@/hooks/useLivePositions', () => ({
  useLivePositions: () => FAKE_SUMMARY.mapMarkers,
}))

// A saúde da frota vem do hook de telemetria, que tem suíte própria (socket e
// releitura); aqui o estado dele é controlado por teste.
const telemetry = vi.hoisted(() => ({
  state: {
    workers: null as AdminWorkersTelemetry | null,
    summary: null as AdminTelemetrySummary | null,
    loading: false,
    failed: false,
  },
}))
vi.mock('@/hooks/useAdminTelemetry', () => ({
  useAdminTelemetry: () => ({ ...telemetry.state, refresh: () => {} }),
}))

const urgent = (id: string, name: string, sector: string) =>
  adminWorker(id, name, {
    worker: { id, name, sector },
    telemetry: { ...reporting({}, 'REAL', id), conditions: [condition('URGENT')] },
  })

const FLEET: AdminWorkersTelemetry = {
  observedAt: '2026-10-01T15:00:00.000Z',
  workers: [
    urgent('w1', 'Ezequiel Almeida', 'Setor Leste'),
    urgent('w2', 'Mariana Costa', 'Setor Leste'),
    urgent('w3', 'Rafael Souza', 'Setor Norte'),
    adminWorker('w4', 'Estável Silva', {
      telemetry: reporting({ fatigueEtaMin: noMetric('min') }, 'REAL', 'w4'),
    }),
  ],
}

const FLEET_SUMMARY = adminSummary({
  vitalSigns: {
    value: 1,
    unit: 'workers',
    coverage: { evaluated: 4, total: 4 },
    measuredAt: null,
    caption: 'Dentro dos limites do piloto',
  },
  urgentAlerts: { workers: 3, total: 4, caption: 'Funcionários com condição urgente ativa' },
})

const FAKE_SUMMARY: DashboardSummary = {
  employees: { total: 12 },
  kpis: {
    admins: 3,
    totalEmployees: 1205,
    newReports: 4,
    activeCameras: 564,
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
  employeeAvatars: { w1: 'https://img/w1.png' },
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
      condition: 'cloudy',
      tempC: 21,
      label: 'PARCIALMENTE\nNUBLADO',
    },
    { at: '2026-05-08T18:00:00.000Z', condition: 'sun', tempC: 24, label: 'SOL' },
  ],
}

beforeEach(() => {
  telemetry.state = { workers: FLEET, summary: FLEET_SUMMARY, loading: false, failed: false }
  // Seed an authenticated session (getSession real exige token + sessão)
  window.localStorage.setItem(TOKEN_STORAGE_KEY, 'jwt-test')
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      id: 'u_seed_1',
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

const renderAt = async () =>
  settled(
    render(
      <SwiThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Dashboard />
          </MemoryRouter>
        </AuthProvider>
      </SwiThemeProvider>,
    ),
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
    await renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument()
    })
    // Resolve dentro de act: solto, o setState que vem daqui cai DEPOIS do
    // teste terminar, fora de qualquer escopo, e o aviso acaba atribuído ao
    // teste seguinte.
    await act(async () => {
      resolveFn({ data: FAKE_SUMMARY, error: null })
    })
  })

  it('renders the KPI row: 2x2 Funcionários grid + 3 donuts', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    await renderAt()
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
    // Donuts de saúde: números e legendas da telemetria, não do simulador.
    const vital = screen.getByTestId('kpi-vital-signs')
    expect(within(vital).getByText('1')).toBeInTheDocument()
    expect(within(vital).getByText('Dentro dos limites do piloto')).toBeInTheDocument()
    const urgentDonut = screen.getByTestId('kpi-urgent-alerts')
    expect(within(urgentDonut).getByText('3')).toBeInTheDocument()
    expect(
      within(urgentDonut).getByText('Funcionários com condição urgente ativa'),
    ).toBeInTheDocument()
    // Desgaste baixo: só o funcionário sem condição de desgaste nem urgência
    // conta; os três urgentes têm desgaste atual sem WEAR_HIGH, então entram.
    const wear = screen.getByTestId('kpi-wear-rate')
    expect(within(wear).getByText('4')).toBeInTheDocument()
    expect(within(wear).getByText('Desgaste baixo')).toBeInTheDocument()
    // DS 0.1.118: pinos dos 3 donuts com label pt-BR (fim do 'Open location').
    expect(screen.getAllByLabelText('Abrir localização no mapa')).toHaveLength(3)
    expect(screen.queryByLabelText('Open location')).not.toBeInTheDocument()
  })

  it('renders the map preview banner and navigates on CTA press', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    await renderAt()
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
    await renderAt()
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
    await renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('wear-alerts-section')).toBeInTheDocument()
    })
    expect(screen.getByTestId('dashboard-two-col-row')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w1')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w2')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-w3')).toBeInTheDocument()
    // A aba padrão é Alertas de Fadiga: o estável fica na sua própria aba.
    expect(screen.queryByTestId('wear-alert-w4')).not.toBeInTheDocument()
  })

  it('filters wear alerts via the SearchInput', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: FAKE_SUMMARY,
      error: null,
    })
    await renderAt()
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
    await renderAt()
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
    await renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('weather-timeline')).toBeInTheDocument()
    })
    // AGORA appears at least once — the event label and/or the now-marker overlay
    expect(screen.getAllByText('AGORA').length).toBeGreaterThan(0)
    // SOL INTENSO and PARCIALMENTE NUBLADO labels appear (newline-separated)
    expect(screen.getAllByText(/SOL/).length).toBeGreaterThan(0)
    expect(screen.getByText(/PARCIALMENTE/)).toBeInTheDocument()
  })

  it('storm slot renderiza a ilustração de tempestade (sem colapsar em rainy)', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: {
        ...FAKE_SUMMARY,
        weather: [
          ...FAKE_SUMMARY.weather.slice(0, 3),
          {
            at: '2026-05-08T14:00:00.000Z',
            condition: 'storm' as const,
            tempC: 21,
            label: 'TEMPESTADE',
          },
        ],
      },
      error: null,
    })
    await renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('weather-timeline')).toBeInTheDocument()
    })
    // WeatherIcon usa a condition como accessibilityLabel — storm deve chegar
    // como 'storm' no DS, não como 'rainy'.
    expect(screen.getByLabelText('storm')).toBeInTheDocument()
  })

  it('renders error panel when summary returns an error', async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    })
    await renderAt()
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
    await renderAt()
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
      // O listener de Dimensions do react-native-web reage a este evento
      // atualizando estado; fora de act o React acusa a atualização.
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })
    }

    afterEach(() => {
      // Restore the desktop default for subsequent tests.
      setViewportWidth(1366)
    })

    it('renders the tablet single-column top row when width < 1024', async () => {
      setViewportWidth(800)
      vi.spyOn(dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
      await renderAt()
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
      await renderAt()
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
      await renderAt()
      await waitFor(() => {
        expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
      })
      expect(screen.getByTestId('dashboard-top-row-wide')).toBeInTheDocument()
      expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument()
      expect(screen.queryByTestId('dashboard-top-row-tablet')).not.toBeInTheDocument()
    })
  })
})

describe('Dashboard: saúde da frota pela telemetria', () => {
  const renderReady = async () => {
    vi.spyOn(dashboardApi, 'summary').mockResolvedValue({ data: FAKE_SUMMARY, error: null })
    await renderAt()
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument()
    })
  }

  it('não mostra mais o selo de dados simulados', async () => {
    await renderReady()
    expect(screen.queryByTestId('simulated-data-badge')).not.toBeInTheDocument()
  })

  it('a aba Excelentes mostra quem tem batimento atual e nenhum alerta', async () => {
    await renderReady()
    fireEvent.click(within(screen.getByTestId('wear-alerts-tabs')).getByText('Excelentes'))
    await waitFor(() => {
      expect(screen.getByTestId('wear-alert-w4')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('wear-alert-w1')).not.toBeInTheDocument()
  })

  it('carregando a telemetria, os donuts dizem isso e a lista também', async () => {
    telemetry.state = { workers: null, summary: null, loading: true, failed: false }
    await renderReady()
    // Três legendas de donut e o aviso da lista.
    expect(screen.getAllByText('Carregando leitura').length).toBe(4)
    expect(screen.getByTestId('wear-alerts-status')).toHaveTextContent('Carregando leitura')
  })

  it('falha na telemetria declara a leitura indisponível, sem número', async () => {
    telemetry.state = { workers: null, summary: null, loading: false, failed: true }
    await renderReady()
    expect(screen.getAllByText('Leitura indisponível no momento').length).toBe(4)
    expect(screen.queryByTestId('wear-alert-w1')).not.toBeInTheDocument()
  })

  it('empresa sem aparelho pareado tem estado vazio honesto', async () => {
    telemetry.state = {
      workers: { observedAt: '2026-10-01T15:00:00.000Z', workers: [] },
      summary: adminSummary({
        vitalSigns: {
          value: null,
          unit: 'workers',
          coverage: { evaluated: 0, total: 0 },
          measuredAt: null,
          caption: 'Sem dados atuais',
        },
        urgentAlerts: { workers: 0, total: 0, caption: 'Sem dados atuais' },
      }),
      loading: false,
      failed: false,
    }
    await renderReady()
    expect(screen.getByTestId('wear-alerts-status')).toHaveTextContent(
      'Nenhum funcionário com aparelho pareado.',
    )
    expect(screen.getAllByText('Sem dados atuais').length).toBe(3)
  })

  it('leitura de demonstração leva o selo de demonstração no card', async () => {
    telemetry.state = {
      ...telemetry.state,
      workers: {
        observedAt: '2026-10-01T15:00:00.000Z',
        workers: [
          adminWorker('d1', 'Demo Silva', {
            telemetry: { ...reporting({}, 'DEMO', 'd1'), conditions: [condition('URGENT')] },
          }),
        ],
      },
    }
    await renderReady()
    expect(screen.getByTestId('wear-alert-d1')).toBeInTheDocument()
    expect(screen.getByTestId('wear-alert-d1-demo')).toHaveTextContent('Dados de demonstração')
  })

  it('quem não tem leitura atual aparece contado, não escondido', async () => {
    telemetry.state = {
      ...telemetry.state,
      workers: {
        observedAt: '2026-10-01T15:00:00.000Z',
        workers: [
          ...FLEET.workers,
          adminWorker('s1', 'Sem Leitura', { telemetry: neverReported('s1') }),
        ],
      },
    }
    await renderReady()
    expect(screen.getByTestId('wear-alerts-unread')).toHaveTextContent(
      '1 funcionário sem leitura atual',
    )
  })

  it('alerta sem batimento conhecido aparece na lista sem inventar número', async () => {
    telemetry.state = {
      ...telemetry.state,
      workers: {
        observedAt: '2026-10-01T15:00:00.000Z',
        workers: [
          adminWorker('h1', 'Sem Batimento', {
            telemetry: {
              ...reporting({ heartRate: noMetric('bpm') }, 'REAL', 'h1'),
              conditions: [condition('HEALTH')],
            },
          }),
        ],
      },
    }
    await renderReady()
    expect(screen.getByTestId('wear-alert-h1')).toHaveTextContent(
      'Sem Batimento: alerta ativo, sem leitura de batimento',
    )
  })
})
