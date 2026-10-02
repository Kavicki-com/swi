// describe/it/expect vêm dos globals do Vitest.
import {
  adminSummary,
  adminWorker,
  condition,
  metric,
  neverReported,
  noMetric,
  reporting,
} from '@/test-utils/telemetryFixtures'
import type { AdminWorkersTelemetry } from '@/services/api/telemetry'
import { healthDonuts, unavailableDonuts, wearRows } from './dashboardHealth'

const list = (...workers: AdminWorkersTelemetry['workers']): AdminWorkersTelemetry => ({
  observedAt: '2026-10-01T15:00:00.000Z',
  workers,
})

// Sem estimativa de fadiga: o ritmo recente não leva ao alerta de desgaste.
const steady = (id: string) => reporting({ fatigueEtaMin: noMetric('min') }, 'REAL', id)

describe('healthDonuts', () => {
  it('sinais vitais e alertas urgentes vêm do resumo, com o preenchimento proporcional', () => {
    const donuts = healthDonuts(
      adminSummary({
        vitalSigns: {
          value: 3,
          unit: 'workers',
          coverage: { evaluated: 3, total: 4 },
          measuredAt: null,
          caption: 'Dentro dos limites do piloto',
        },
        urgentAlerts: { workers: 1, total: 4, caption: 'Funcionários com condição urgente ativa' },
      }),
      list(),
    )
    expect(donuts.vitalSigns).toEqual({
      value: 3,
      progress: 75,
      caption: 'Dentro dos limites do piloto',
    })
    expect(donuts.urgentAlerts).toEqual({
      value: 1,
      progress: 25,
      caption: 'Funcionários com condição urgente ativa',
    })
  })

  it('sem população, os donuts dizem que não há dado em vez de mostrar zero', () => {
    const donuts = healthDonuts(
      adminSummary({
        vitalSigns: {
          value: null,
          unit: 'workers',
          coverage: { evaluated: 0, total: 0 },
          measuredAt: null,
          caption: 'Sem dados atuais',
        },
        urgentAlerts: { workers: 0, total: 0, caption: 'Sem dados atuais' },
      }),
      list(),
    )
    expect(donuts.vitalSigns).toEqual({ value: '--', progress: 0, caption: 'Sem dados atuais' })
    expect(donuts.urgentAlerts).toEqual({ value: '--', progress: 0, caption: 'Sem dados atuais' })
    expect(donuts.wear).toEqual({ value: '--', progress: 0, caption: 'Sem dados atuais' })
  })

  // Desgaste baixo = desgaste avaliado agora e nenhuma condição de desgaste
  // aberta. Sem limiar inventado: é o motor de condições que decide o alto.
  it('desgaste baixo conta quem tem desgaste atual e nenhum alerta de desgaste', () => {
    const donuts = healthDonuts(
      adminSummary(),
      list(
        adminWorker('a', 'Ana'),
        adminWorker('b', 'Bruno', {
          telemetry: { ...reporting({}, 'REAL', 'b'), conditions: [condition('HEALTH')] },
        }),
        adminWorker('c', 'Carla', { telemetry: neverReported('c') }),
        adminWorker('d', 'Davi'),
      ),
    )
    expect(donuts.wear).toEqual({ value: 2, progress: 50, caption: 'Desgaste baixo' })
  })

  it('demonstração não entra no donut de desgaste, como o resumo não a conta', () => {
    const donuts = healthDonuts(
      adminSummary(),
      list(adminWorker('a', 'Ana', { telemetry: reporting({}, 'DEMO', 'a') })),
    )
    expect(donuts.wear).toEqual({ value: '--', progress: 0, caption: 'Sem dados atuais' })
  })
})

describe('unavailableDonuts', () => {
  it('sem leitura (carregando ou falha), os três donuts declaram a ausência com a frase dada', () => {
    const donuts = unavailableDonuts('Leitura indisponível no momento')
    for (const d of [donuts.vitalSigns, donuts.wear, donuts.urgentAlerts]) {
      expect(d).toEqual({ value: '--', progress: 0, caption: 'Leitura indisponível no momento' })
    }
  })
})

describe('wearRows', () => {
  it('mantém a ordem do backend e separa as faixas pelas condições', () => {
    const rows = wearRows(
      list(
        adminWorker('u', 'Urgente', {
          telemetry: { ...reporting({}, 'REAL', 'u'), conditions: [condition('URGENT')] },
        }),
        adminWorker('d', 'Desgastando'),
        adminWorker('e', 'Estável', { telemetry: steady('e') }),
        adminWorker('s', 'Sem leitura', { telemetry: neverReported('s') }),
      ),
      {},
    )
    expect(rows.map((r) => [r.id, r.tier])).toEqual([
      ['u', 'alerta-fadiga'],
      ['d', 'desgastado'],
      ['e', 'excelente'],
      ['s', null],
    ])
  })

  it('condição só de aparelho não muda a faixa de saúde', () => {
    const [row] = wearRows(
      list(
        adminWorker('e', 'Estável', {
          telemetry: { ...steady('e'), conditions: [condition('DEVICE')] },
        }),
      ),
      {},
    )
    expect(row?.tier).toBe('excelente')
  })

  it('traz desgaste, batimento, pressão, avatar e o selo de demonstração', () => {
    const [row] = wearRows(
      list(
        adminWorker('a', 'Ana', {
          telemetry: reporting(
            { bloodPressure: metric({ systolic: 128, diastolic: 82 }) },
            'DEMO',
            'a',
          ),
        }),
      ),
      { a: 'https://img/a.png' },
    )
    expect(row).toMatchObject({
      employeeName: 'Ana',
      sector: 'Operações',
      progress: 38,
      bpm: 112,
      pressure: '128/82',
      avatarUri: 'https://img/a.png',
      demo: true,
    })
  })

  it('sem leitura de batimento, usa o valor que abriu a condição de batimento', () => {
    const [row] = wearRows(
      list(
        adminWorker('u', 'Urgente', {
          telemetry: {
            ...reporting({ heartRate: noMetric('bpm') }, 'REAL', 'u'),
            conditions: [condition('URGENT', { observedValue: 185 })],
          },
        }),
      ),
      {},
    )
    expect(row?.bpm).toBe(185)
    expect(row?.pressure).toBeNull()
  })

  it('sem batimento algum, o batimento fica nulo e o desgaste ausente fica sem barra', () => {
    const [row] = wearRows(
      list(adminWorker('s', 'Sem leitura', { telemetry: neverReported('s') })),
      {},
    )
    expect(row?.bpm).toBeNull()
    expect(row?.progress).toBeUndefined()
  })

  it('diz se o funcionário tem aparelho pareado', () => {
    const rows = wearRows(
      list(
        adminWorker('p', 'Pareado'),
        adminWorker('n', 'Sem aparelho', {
          device: { state: 'NONE', lastSeenAt: null },
          telemetry: neverReported('n'),
        }),
      ),
      {},
    )
    expect(rows.map((r) => [r.id, r.paired])).toEqual([
      ['p', true],
      ['n', false],
    ])
  })
})
