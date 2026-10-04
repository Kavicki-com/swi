// vitest globals via globals: true — importar de 'vitest' quebraria o suite.
import { vi } from 'vitest'

vi.mock('./users', () => ({
  adminsApi: { list: vi.fn() },
  employeesApi: { list: vi.fn() },
}))
vi.mock('./reports', () => ({
  reportsApi: { list: vi.fn() },
}))
vi.mock('./telemetry', () => ({
  telemetryApi: { alerts: vi.fn() },
}))
vi.mock('./cameras', () => ({
  countCameras: vi.fn(),
}))

import {
  alertDetailFrom,
  buildGoodConditions,
  buildKpis,
  buildUserAlerts,
  monitoringApi,
} from './monitoring'
import { adminsApi, employeesApi, type Employee } from './users'
import { reportsApi } from './reports'
import { telemetryApi } from './telemetry'
import { countCameras } from './cameras'
import {
  adminSummary,
  adminWorker,
  alertItem,
  condition,
  metric,
  neverReported,
  reporting,
} from '@/test-utils/telemetryFixtures'

const OLD = '2026-10-01T14:20:00.000Z'
const clock = (iso: string) => {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
}

const employee = (id: string, name: string): Employee =>
  ({
    id,
    name,
    age: 32,
    bloodType: 'A+',
    role: 'Operador',
    specialization: 'Setor Leste',
    sector: 'Setor Leste',
    avatarUri: '',
    vitalsStatus: 'good',
    active: true,
  }) as Employee

describe('alertDetailFrom', () => {
  it('batimento alto cita o valor e o limite, com tom de urgência', () => {
    const d = alertDetailFrom(alertItem('a1'))
    expect(d.title).toBe('Frequência cardíaca alta')
    expect(d.description).toBe('185 bpm, acima do limite de 167 bpm')
    expect(d.tone).toBe('error')
    expect(d.notes?.[0]).toBe(`Urgente, aberto às ${clock(alertItem('a1').condition.openedAt)}`)
  })

  it('desgaste alto é atenção, não urgência', () => {
    const d = alertDetailFrom(
      alertItem('a2', {
        condition: {
          kind: 'WEAR_HIGH',
          category: 'HEALTH',
          observedValue: 82.4,
          thresholdValue: 80,
          openedAt: OLD,
          recoveredAt: null,
        },
      }),
    )
    expect(d.title).toBe('Desgaste alto')
    expect(d.description).toBe('Desgaste estimado em 82%, limite de 80%')
    expect(d.tone).toBe('warning')
  })

  it('sem valor gravado a frase não inventa número', () => {
    const d = alertDetailFrom(
      alertItem('a3', {
        condition: {
          kind: 'HEART_RATE_LOW',
          category: 'URGENT',
          observedValue: null,
          thresholdValue: null,
          openedAt: OLD,
          recoveredAt: null,
        },
      }),
    )
    expect(d.description).toBe('Batimento abaixo do limite configurado')
  })

  it('leitura normalizada e origem de demonstração aparecem como notas', () => {
    const item = alertItem('a4', {
      origin: 'DEMO',
      condition: { ...alertItem('x').condition, recoveredAt: OLD },
    })
    const d = alertDetailFrom(item)
    expect(d.notes).toContain(`Leitura já voltou ao normal às ${clock(OLD)}`)
    expect(d.notes).toContain('Dados de demonstração')
  })

  it('aberto pode ser reconhecido e resolvido; reconhecido só resolvido; resolvido nada', () => {
    expect(alertDetailFrom(alertItem('o')).triage).toMatchObject({
      alertId: 'o',
      canAcknowledge: true,
      canResolve: true,
      triageLine: null,
    })
    const ack = alertDetailFrom(
      alertItem('k', {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: OLD,
        triagedBy: { id: 'adm', name: 'Elisa' },
      }),
    )
    expect(ack.triage).toMatchObject({ canAcknowledge: false, canResolve: true })
    expect(ack.triage?.triageLine).toBe(`Reconhecido por Elisa às ${clock(OLD)}`)
    const done = alertDetailFrom(
      alertItem('r', {
        status: 'RESOLVED',
        resolvedAt: OLD,
        triagedBy: { id: 'adm', name: 'Elisa' },
      }),
    )
    expect(done.triage).toMatchObject({ canAcknowledge: false, canResolve: false })
    expect(done.triage?.triageLine).toBe(`Resolvido por Elisa às ${clock(OLD)}`)
  })
})

describe('buildUserAlerts', () => {
  const employees = [
    employee('w-urg', 'Urgente Um'),
    employee('w-hea', 'Atenção Um'),
    employee('w-ok', 'Bem Um'),
    employee('w-none', 'Sem Leitura'),
    employee('w-stale', 'Leitura Velha'),
  ]
  const workers = [
    adminWorker('w-urg', 'Urgente Um', {
      telemetry: { ...reporting({}, 'REAL', 'w-urg'), conditions: [condition('URGENT')] },
    }),
    adminWorker('w-hea', 'Atenção Um', {
      telemetry: { ...reporting({}, 'REAL', 'w-hea'), conditions: [condition('HEALTH')] },
    }),
    adminWorker('w-ok', 'Bem Um', {
      telemetry: { ...reporting({}, 'REAL', 'w-ok'), conditions: [condition('DEVICE')] },
    }),
    adminWorker('w-none', 'Sem Leitura', { telemetry: neverReported('w-none') }),
    adminWorker('w-stale', 'Leitura Velha', {
      telemetry: reporting({ heartRate: metric(90, { quality: 'STALE' }) }, 'REAL', 'w-stale'),
    }),
  ]

  it('a aba vem das condições abertas; aparelho não piora ninguém; sem leitura atual não é excelente', () => {
    const rows = buildUserAlerts(employees, workers, [])
    const tierOf = (id: string) => rows.find((r) => r.id === id)?.tier
    expect(tierOf('w-urg')).toBe('alerta-fadiga')
    expect(tierOf('w-hea')).toBe('desgastado')
    expect(tierOf('w-ok')).toBe('excelente')
    expect(tierOf('w-none')).toBe('sem-leitura')
    expect(tierOf('w-stale')).toBe('sem-leitura')
  })

  it('alerta ainda não triado mantém a pessoa na aba mesmo com a condição já recuperada', () => {
    const queue = [
      alertItem('a1', {
        worker: { id: 'w-ok', name: 'Bem Um', sector: null },
        condition: { ...alertItem('x').condition, recoveredAt: OLD },
      }),
    ]
    const row = buildUserAlerts(employees, workers, queue).find((r) => r.id === 'w-ok')
    expect(row?.tier).toBe('alerta-fadiga')
    expect(row?.alerts.map((a) => a.id)).toEqual(['a1'])
  })

  it('alerta resolvido não segura ninguém na aba', () => {
    const queue = [
      alertItem('a1', { status: 'RESOLVED', worker: { id: 'w-ok', name: 'Bem Um', sector: null } }),
    ]
    const row = buildUserAlerts(employees, workers, queue).find((r) => r.id === 'w-ok')
    expect(row?.tier).toBe('excelente')
    expect(row?.alerts).toHaveLength(1)
  })

  it('ordem: urgentes, atenção, excelentes e sem leitura, por nome dentro de cada grupo', () => {
    const rows = buildUserAlerts(employees, workers, [])
    expect(rows.map((r) => r.id)).toEqual(['w-urg', 'w-hea', 'w-ok', 'w-stale', 'w-none'])
  })

  it('sem telemetria carregada ninguém é avaliado', () => {
    expect(buildUserAlerts(employees, null, []).every((r) => r.tier === 'sem-leitura')).toBe(true)
  })
})

describe('buildKpis', () => {
  it('pressão e movimentos vêm do resumo real; fadiga é a contagem da aba', () => {
    const kpis = buildKpis({
      admins: 3,
      workers: 5,
      pendingReports: 2,
      cameras: 4,
      fatigueCount: 1,
      summary: adminSummary(),
    })
    const byId = Object.fromEntries(kpis.map((k) => [k.id, k.value]))
    expect(byId).toMatchObject({
      admins: '3',
      workers: '5',
      reports: '2',
      cameras: '4',
      fatigue: '1',
      pressure: '124/80',
      movements: (1840).toLocaleString('pt-BR'),
    })
  })

  it('sem resumo, pressão e movimentos são ausência, nunca zero', () => {
    const byId = Object.fromEntries(
      buildKpis({
        admins: 0,
        workers: 0,
        pendingReports: 0,
        cameras: 0,
        fatigueCount: 0,
        summary: null,
      }).map((k) => [k.id, k.value]),
    )
    expect(byId.pressure).toBe('--')
    expect(byId.movements).toBe('--')
    expect(byId.cameras).toBe('0')
  })

  it('câmeras que não carregaram são ausência, nunca zero', () => {
    const byId = Object.fromEntries(
      buildKpis({
        admins: 0,
        workers: 0,
        pendingReports: 0,
        cameras: null,
        fatigueCount: 0,
        summary: null,
      }).map((k) => [k.id, k.value]),
    )
    expect(byId.cameras).toBe('--')
  })
})

describe('buildGoodConditions', () => {
  it('donuts calculados do resumo, com a legenda do backend', () => {
    const view = buildGoodConditions(adminSummary(), false)
    expect(view.vitals).toMatchObject({ value: '2', progress: 50, caption: 'Média recente' })
    expect(view.fatigueRate).toMatchObject({ value: '42%', progress: 42 })
    expect(view.heartrate).toMatchObject({ value: '96', label: 'BPM', progress: 75 })
    expect(view.urgentAlerts).toMatchObject({ value: '1', progress: 25 })
  })

  it('falha na leitura diz isso em vez de mostrar zero', () => {
    const view = buildGoodConditions(null, true)
    expect(view.vitals).toMatchObject({
      value: '--',
      progress: 0,
      caption: 'Leitura indisponível no momento',
    })
    expect(buildGoodConditions(null, false).heartrate.caption).toBe('Sem dados atuais')
  })
})

describe('monitoringApi', () => {
  beforeEach(() => {
    vi.mocked(adminsApi.list).mockResolvedValue({ data: [{}, {}, {}], error: null } as never)
    vi.mocked(employeesApi.list).mockResolvedValue({
      data: [employee('w1', 'Ana')],
      error: null,
    } as never)
    vi.mocked(reportsApi.list).mockResolvedValue({
      data: [{ status: 'pending' }, { status: 'accept' }, { status: 'pending' }],
      error: null,
    } as never)
  })

  it('diretório traz as contagens e os funcionários do cadastro', async () => {
    vi.mocked(countCameras).mockResolvedValue(6)
    const { data } = await monitoringApi.directory()
    expect(data).toMatchObject({ admins: 3, pendingReports: 2, cameras: 6 })
    expect(data?.employees.map((e) => e.id)).toEqual(['w1'])
  })

  it('falha do diretório degrada para listas vazias, nunca lança', async () => {
    vi.mocked(employeesApi.list).mockResolvedValue({ data: null, error: { message: 'e' } } as never)
    const { data, error } = await monitoringApi.directory()
    expect(error).toBeNull()
    expect(data?.employees).toEqual([])
  })

  it('a fila pede os alertas abertos e reconhecidos', async () => {
    vi.mocked(telemetryApi.alerts).mockResolvedValue({
      data: { items: [alertItem('a1')], nextCursor: null },
      error: null,
    })
    const { data } = await monitoringApi.queue()
    expect(telemetryApi.alerts).toHaveBeenCalledWith({ status: ['OPEN', 'ACKNOWLEDGED'] })
    expect(data?.map((a) => a.id)).toEqual(['a1'])
  })

  it('falha da fila chega como erro, nunca como fila vazia', async () => {
    vi.mocked(telemetryApi.alerts).mockResolvedValue({ data: null, error: { message: 'offline' } })
    const { data, error } = await monitoringApi.queue()
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'offline' })
  })
})
