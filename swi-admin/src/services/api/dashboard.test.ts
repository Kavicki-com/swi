// vitest globals (describe/it/expect/beforeEach) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o suite (ver nota no auth.test.ts).
import { vi } from 'vitest'

// As 4 fachadas do fan-out são mockadas; os VITAIS derivam dos funcionários
// sintéticos via simulatedVitalsFor (determinístico) — o teste assere a
// derivação, não fixtures.
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
import { ACTIVE_CAMERAS } from '@/services/cameras'

// Funcionários sintéticos COM identidade — os vitais simulados derivam do id.
const list = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `emp-${i}`,
    name: `Func ${i}`,
    sector: `Setor ${i % 3}`,
    avatarUri: i % 2 ? `url-${i}` : '',
  }))
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

describe('dashboardApi.summary', () => {
  it('derives real KPI counts: admins / totalEmployees / newReports (pending filter)', async () => {
    const { data, error } = await dashboardApi.summary()
    expect(error).toBeNull()
    expect(data!.kpis.admins).toBe(3)
    expect(data!.kpis.totalEmployees).toBe(5)
    // 2 of the 4 reports are 'pending'
    expect(data!.kpis.newReports).toBe(2)
  })

  it('maps work-orders → activities across the 3 statuses (no risk)', async () => {
    const { data } = await dashboardApi.summary()
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

  it('deriva desgaste/vitais dos funcionários REAIS com vitais simulados plausíveis', async () => {
    const { data } = await dashboardApi.summary()
    // Posições agora são reais: o Dashboard splica useLivePositions() sobre o
    // summary — o serviço não fabrica mais markers mock.
    expect(data!.mapMarkers).toEqual([])
    // Wear alerts: um por funcionário real, com nome/setor do diretório e
    // vitais plausíveis (nunca 0 bpm).
    expect(data!.wearAlerts).toHaveLength(5)
    expect(data!.wearAlerts.map((w) => w.employeeName)).toEqual([
      'Func 0',
      'Func 1',
      'Func 2',
      'Func 3',
      'Func 4',
    ])
    for (const w of data!.wearAlerts) {
      expect(w.bpm).toBeGreaterThanOrEqual(55)
      expect(w.pressure).toMatch(/^\d{2}\/\d{1,2}$/)
      expect(['excelente', 'desgastado', 'alerta-fadiga']).toContain(w.tier)
    }
    // KPIs vitais: partição dos 5 funcionários pelos 3 tiers (soma fecha).
    const { vitalSigns, wearRate, urgentAlerts } = data!.kpis
    expect(vitalSigns + wearRate + urgentAlerts).toBe(5)
    expect(data!.employees.total).toBe(5)
    expect(
      data!.employees.byStatus.good + data!.employees.byStatus.alert + data!.employees.byStatus.low,
    ).toBe(5)
    // Câmeras: o KPI conta a MESMA frota que o mapa desenha (services/cameras),
    // senão o número da tela diverge da quantidade de pinos.
    expect(data!.kpis.activeCameras).toBe(ACTIVE_CAMERAS)
  })

  it('passes the real weather strip through', async () => {
    const { data } = await dashboardApi.summary()
    expect(data!.weather).toEqual([weatherSlot])
  })

  it('degrades weather to [] when the weather facade returns an error', async () => {
    vi.mocked(weatherApi.get).mockResolvedValue({ data: null, error: { message: 'boom' } } as never)
    const { data, error } = await dashboardApi.summary()
    expect(error).toBeNull()
    expect(data!.weather).toEqual([])
    // the rest stays real
    expect(data!.kpis.admins).toBe(3)
  })

  it('degrades newReports to 0 when the reports facade fails', async () => {
    vi.mocked(reportsApi.list).mockResolvedValue({ data: null, error: { message: 'x' } } as never)
    const { data } = await dashboardApi.summary()
    expect(data!.kpis.newReports).toBe(0)
  })

  it('degrades activities to [] when the raw work-orders facade THROWS', async () => {
    vi.mocked(workOrdersApi.list).mockRejectedValue(new Error('ApiError 500'))
    const { data, error } = await dashboardApi.summary()
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
    const { data, error } = await dashboardApi.summary()
    expect(error).toBeNull()
    expect(data!.kpis.admins).toBe(0)
    expect(data!.kpis.totalEmployees).toBe(0)
    expect(data!.kpis.newReports).toBe(0)
    expect(data!.activities).toEqual([])
    expect(data!.weather).toEqual([])
    // Sem diretório → sem desgaste fabricado: lista vazia, não roster fake.
    expect(data!.wearAlerts).toEqual([])
  })
})
