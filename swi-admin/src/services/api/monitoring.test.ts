// vitest globals via globals: true — importar de 'vitest' quebraria o suite.
import { vi } from 'vitest'

vi.mock('./users', () => ({
  adminsApi: { list: vi.fn() },
  employeesApi: { list: vi.fn() },
}))
vi.mock('./reports', () => ({
  reportsApi: { list: vi.fn() },
}))

import { monitoringApi } from './monitoring'
import { adminsApi, employeesApi } from './users'
import { reportsApi } from './reports'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

const employees = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `emp-${i}`,
    name: `Func ${i}`,
    age: 30 + i,
    bloodType: i % 2 ? 'A+' : '—',
    role: 'Operador',
    specialization: `Setor ${i % 2}`,
    sector: `Setor ${i % 2}`,
    avatarUri: '',
    vitalsStatus: 'good',
  }))

beforeEach(() => {
  vi.mocked(adminsApi.list).mockResolvedValue({ data: employees(3), error: null } as never)
  vi.mocked(employeesApi.list).mockResolvedValue({ data: employees(5), error: null } as never)
  vi.mocked(reportsApi.list).mockResolvedValue({
    data: [{ status: 'pending' }, { status: 'accept' }, { status: 'pending' }],
    error: null,
  } as never)
})

describe('monitoringApi (real)', () => {
  it('kpis: contagens REAIS (admins/funcionários/relatórios) + fadiga derivada dos tiers simulados', async () => {
    const { data } = await monitoringApi.kpis()
    const byId = Object.fromEntries(data!.map((k) => [k.id, k.value]))
    expect(byId.admins).toBe('3')
    expect(byId.workers).toBe('5')
    expect(byId.reports).toBe('2')
    // Fadiga = quantos funcionários caem no tier alerta-fadiga (determinístico).
    const expectedFatigue = employees(5).filter(
      (e) => simulatedVitalsFor(e.id, Date.now()).tier === 'alerta-fadiga',
    ).length
    expect(byId.fatigue).toBe(String(expectedFatigue))
    // Pressão média plausível (formato "12/8"), nunca vazia.
    expect(byId.pressure).toMatch(/^\d{2}\/\d{1,2}$/)
  })

  it('alertUsers: um card por funcionário REAL; alertas derivam do tier (fadiga expandido, excelente colapsado)', async () => {
    const { data } = await monitoringApi.alertUsers()
    expect(data).toHaveLength(5)
    for (const row of data!) {
      const v = simulatedVitalsFor(row.id, Date.now())
      if (v.tier === 'alerta-fadiga') {
        expect(row.alerts.length).toBeGreaterThanOrEqual(2)
        expect(row.alerts[0]!.tone).toBe('error')
        // A descrição cita o bpm SIMULADO coerente — nada de números soltos.
        expect(row.alerts[0]!.description).toContain(String(v.bpm))
      } else if (v.tier === 'desgastado') {
        expect(row.alerts).toHaveLength(1)
        expect(row.alerts[0]!.tone).toBe('warning')
      } else {
        expect(row.alerts).toEqual([])
      }
    }
  })

  it('goodConditionsStats: derivado da mesma população (soma fecha, bpm médio plausível)', async () => {
    const { data } = await monitoringApi.goodConditionsStats()
    expect(data!.vitals.value).toBeGreaterThanOrEqual(0)
    expect(data!.vitals.value).toBeLessThanOrEqual(5)
    expect(data!.heartrate.value).toBeGreaterThanOrEqual(55)
    expect(data!.heartrate.value).toBeLessThanOrEqual(145)
    expect(data!.urgentAlerts.value).toBeGreaterThanOrEqual(0)
  })

  it('falha do diretório degrada pra listas/contagens vazias (nunca lança)', async () => {
    vi.mocked(employeesApi.list).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    const kpis = await monitoringApi.kpis()
    const users = await monitoringApi.alertUsers()
    expect(kpis.error).toBeNull()
    expect(users.data).toEqual([])
  })
})
