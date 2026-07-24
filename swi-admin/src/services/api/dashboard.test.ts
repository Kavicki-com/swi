// vitest globals (describe/it/expect/beforeEach) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o suite (ver nota no auth.test.ts).
import { vi } from 'vitest'

// As 4 fachadas do fan-out são mockadas; os VITAIS (dashboardMockVitals) usam a
// fixture real (SEED/ROSTER) de propósito — o teste assere que a sobreposição
// mock vem de lá.
vi.mock('./users', () => ({
  adminsApi: { list: vi.fn() },
  employeesApi: { list: vi.fn() },
}))
vi.mock('./reports', () => ({
  reportsApi: { list: vi.fn() },
}))
vi.mock('./workOrders', () => ({
  workOrdersApi: { list: vi.fn() },
}))
vi.mock('./weather', () => ({
  weatherApi: { get: vi.fn() },
}))

import { dashboardApi } from './dashboard'
import { adminsApi, employeesApi } from './users'
import { reportsApi } from './reports'
import { workOrdersApi } from './workOrders'
import { weatherApi } from './weather'
import { buildMockMapMarkers, MOCK_VITAL_KPIS, MOCK_WEAR_ALERTS } from './dashboardMockVitals'

const list = (n: number) => new Array(n).fill({})
const report = (status: string) => ({ status })
const weatherSlot = { at: '2026-07-23T12:00:00.000Z', condition: 'sun', tempC: 20, label: 'SOL' }

// 3 work-orders — uma de cada status, com avatares/contagem distintos.
const WO_ROWS = [
  {
    id: 'wo1',
    title: 'Reparo',
    sector: 'Setor Leste',
    status: 'pending',
    progressPct: 0,
    responsibleCount: 3,
    responsibleAvatars: ['url-a', ''],
  },
  {
    id: 'wo2',
    title: 'Manutenção',
    sector: 'Setor Norte',
    status: 'in_progress',
    progressPct: 42,
    responsibleCount: 5,
    responsibleAvatars: ['url-b', 'url-c'],
  },
  {
    id: 'wo3',
    title: 'Inspeção',
    sector: 'Setor Sul',
    status: 'done',
    progressPct: 100,
    responsibleCount: 1,
    responsibleAvatars: ['url-d'],
  },
]

beforeEach(() => {
  vi.mocked(adminsApi.list).mockResolvedValue({ data: list(3), error: null } as never)
  vi.mocked(employeesApi.list).mockResolvedValue({ data: list(5), error: null } as never)
  vi.mocked(reportsApi.list).mockResolvedValue({
    data: [report('pending'), report('accept'), report('pending'), report('canceled')],
    error: null,
  } as never)
  vi.mocked(workOrdersApi.list).mockResolvedValue(WO_ROWS as never)
  vi.mocked(weatherApi.get).mockResolvedValue({ data: [weatherSlot], error: null } as never)
})

describe('dashboardApi.mapMarkers', () => {
  it('serve os markers mock direto, sem disparar o fan-out de rede', async () => {
    const { data, error } = await dashboardApi.mapMarkers({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data).toEqual(buildMockMapMarkers('org_seed_1'))
    // Razão de existir do acessor: Maps/Alerts só precisam dos markers (mock);
    // summary() dispararia 5 chamadas reais descartadas.
    expect(adminsApi.list).not.toHaveBeenCalled()
    expect(employeesApi.list).not.toHaveBeenCalled()
    expect(reportsApi.list).not.toHaveBeenCalled()
    expect(workOrdersApi.list).not.toHaveBeenCalled()
    expect(weatherApi.get).not.toHaveBeenCalled()
  })
})

describe('dashboardApi.summary', () => {
  it('derives real KPI counts: admins / totalEmployees / newReports (pending filter)', async () => {
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data!.kpis.admins).toBe(3)
    expect(data!.kpis.totalEmployees).toBe(5)
    // 2 of the 4 reports are 'pending'
    expect(data!.kpis.newReports).toBe(2)
  })

  it('maps work-orders → activities across the 3 statuses (no risk)', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data!.activities).toHaveLength(3)
    const [a1, a2, a3] = data!.activities
    expect(a1).toMatchObject({
      id: 'wo1',
      title: 'Reparo',
      sector: 'Setor Leste',
      locationLabel: 'Setor Leste',
      status: 'a-fazer',
      progress: 0,
      totalParticipants: 3,
    })
    // '' avatar → { uri: undefined }; real url preserved.
    expect(a1!.participants).toEqual([{ uri: 'url-a' }, { uri: undefined }])
    expect(a2!.status).toBe('em-curso')
    expect(a2!.progress).toBe(42)
    expect(a3!.status).toBe('concluida')
    // risk is vitals-derived → omitted so ProgressBar uses default color.
    expect(a1!.risk).toBeUndefined()
    expect(a2!.risk).toBeUndefined()
    expect(a3!.risk).toBeUndefined()
  })

  it('overlays mock vitals (mapMarkers / wearAlerts / activeCameras) from the fixture', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data!.mapMarkers).toEqual(buildMockMapMarkers('org_seed_1'))
    expect(data!.mapMarkers.length).toBeGreaterThan(0)
    expect(data!.wearAlerts).toEqual(MOCK_WEAR_ALERTS)
    expect(data!.kpis.activeCameras).toBe(MOCK_VITAL_KPIS.activeCameras)
    expect(data!.kpis.vitalSigns).toBe(MOCK_VITAL_KPIS.vitalSigns)
    expect(data!.kpis.wearRate).toBe(MOCK_VITAL_KPIS.wearRate)
  })

  it('passes the real weather strip through', async () => {
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data!.weather).toEqual([weatherSlot])
  })

  it('degrades weather to [] when the weather facade returns an error', async () => {
    vi.mocked(weatherApi.get).mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data!.weather).toEqual([])
    // the rest stays real
    expect(data!.kpis.admins).toBe(3)
  })

  it('degrades newReports to 0 when the reports facade fails', async () => {
    vi.mocked(reportsApi.list).mockResolvedValue({ data: null, error: { message: 'x' } } as never)
    const { data } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(data!.kpis.newReports).toBe(0)
  })

  it('degrades activities to [] when the raw work-orders facade THROWS', async () => {
    vi.mocked(workOrdersApi.list).mockRejectedValue(new Error('ApiError 500'))
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    // summary must never reject — activities empty, everything else intact
    expect(error).toBeNull()
    expect(data!.activities).toEqual([])
    expect(data!.kpis.totalEmployees).toBe(5)
  })

  it('never rejects even if every facade fails', async () => {
    vi.mocked(adminsApi.list).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    vi.mocked(employeesApi.list).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    vi.mocked(reportsApi.list).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    vi.mocked(workOrdersApi.list).mockRejectedValue(new Error('down'))
    vi.mocked(weatherApi.get).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    const { data, error } = await dashboardApi.summary({ orgId: 'org_seed_1' })
    expect(error).toBeNull()
    expect(data!.kpis.admins).toBe(0)
    expect(data!.kpis.totalEmployees).toBe(0)
    expect(data!.kpis.newReports).toBe(0)
    expect(data!.activities).toEqual([])
    expect(data!.weather).toEqual([])
    // vitals always present
    expect(data!.wearAlerts).toEqual(MOCK_WEAR_ALERTS)
  })
})
