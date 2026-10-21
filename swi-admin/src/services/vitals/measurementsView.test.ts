// describe/it/expect vêm dos globals do Vitest; importar de 'vitest' duplica a instância.
import type { HeartRateReference, WorkerTelemetry } from '@/services/api/telemetry'
import {
  FIXTURE_AT,
  FIXTURE_NOW,
  metric,
  neverReported,
  noMetric as none,
  reporting,
} from '@/test-utils/telemetryFixtures'
import { whenLabel } from '@/lib/whenLabel'
import { DEMO_DATA_LABEL, NO_DEVICE_LABEL, PROVISIONAL_BASELINE_LABEL } from './vitalsView'
import {
  measurementsViewFrom,
  type MeasurementKey,
  type WorkerMeasurementsView,
} from './measurementsView'

const now = new Date(FIXTURE_NOW).getTime()

const reference = (over: Partial<HeartRateReference> = {}): HeartRateReference => ({
  restingBpm: 62,
  restingSource: 'MEASURED',
  provisionalFrom: null,
  measuredDays: 9,
  maxBpm: 181,
  computedAt: FIXTURE_AT,
  ...over,
})

const withReference = (ref: HeartRateReference | null | undefined): WorkerTelemetry =>
  ref === undefined ? reporting() : { ...reporting(), heartRateReference: ref }

function entryOf(view: WorkerMeasurementsView, key: MeasurementKey) {
  if (view.kind !== 'entries') throw new Error(`esperava entradas, veio ${view.kind}`)
  const entry = view.entries.find((e) => e.key === key)
  if (!entry) throw new Error(`sem a entrada ${key}`)
  return { value: entry.value, caption: entry.caption }
}

const NOTHING = { value: null, caption: null }

describe('measurementsViewFrom', () => {
  it('sem relógio pareado mostra só a frase, mesmo com leitura guardada', () => {
    expect(measurementsViewFrom(reporting(), { noDevice: true })).toEqual({
      kind: 'empty',
      message: NO_DEVICE_LABEL,
    })
  })

  it('sem saber ainda se há relógio, espera; se a consulta falhou, diz que está indisponível', () => {
    expect(measurementsViewFrom(reporting(), { deviceUnknown: true })).toEqual({
      kind: 'empty',
      message: 'Verificando o relógio…',
    })
    expect(measurementsViewFrom(reporting(), { deviceUnknown: true, failed: true })).toEqual({
      kind: 'empty',
      message: 'Leitura indisponível no momento',
    })
  })

  it('sem saber se há relógio, espera mesmo sem leitura alguma', () => {
    expect(measurementsViewFrom(null, { deviceUnknown: true })).toEqual({
      kind: 'empty',
      message: 'Verificando o relógio…',
    })
  })

  it('sem leitura, ou de quem nunca reportou, diz que não há leitura; com falha, que está indisponível', () => {
    const empty = { kind: 'empty', message: 'Sem leitura do aparelho' }
    expect(measurementsViewFrom(null)).toEqual(empty)
    expect(measurementsViewFrom(neverReported())).toEqual(empty)
    expect(measurementsViewFrom(null, { failed: true })).toEqual({
      kind: 'empty',
      message: 'Leitura indisponível no momento',
    })
  })

  it('com leitura traz sempre as sete medições, na ordem, com rótulos e ícone', () => {
    const view = measurementsViewFrom(reporting(), { now })
    if (view.kind !== 'entries') throw new Error('esperava entradas')
    expect(
      view.entries.map(({ key, label, centerLabel, icon }) => ({ key, label, centerLabel, icon })),
    ).toEqual([
      { key: 'oxygen', label: 'Oxigenação', centerLabel: 'Saturação', icon: 'water_drop' },
      {
        key: 'temperature',
        label: 'Temperatura',
        centerLabel: 'Corporal',
        icon: 'device_thermostat',
      },
      { key: 'steps', label: 'Passos', centerLabel: 'Passos dados', icon: 'footprint' },
      { key: 'distance', label: 'Distância', centerLabel: 'Percorrida', icon: 'directions_walk' },
      { key: 'movement', label: 'Movimento', centerLabel: 'Ritmo atual', icon: 'health_activity' },
      { key: 'resting', label: 'Repouso', centerLabel: 'Batimento', icon: 'favorite' },
      { key: 'max', label: 'Máxima', centerLabel: 'Batimento', icon: 'heartbeat' },
    ])
  })

  // Só a oxigenação tem escala própria; para as outras o anel não inventa
  // meta: cheio quando há leitura, vazio sem ela.
  it('anel da rosca: oxigenação enche pela própria porcentagem, as demais cheias com leitura', () => {
    const progressOf = (view: WorkerMeasurementsView) => {
      if (view.kind !== 'entries') throw new Error('esperava entradas')
      return Object.fromEntries(view.entries.map((e) => [e.key, e.progress]))
    }
    const full = measurementsViewFrom(
      {
        ...reporting({
          oxygenSaturation: metric(96.6),
          bodyTemperature: metric(36.5),
          steps: metric(0),
          distance: metric(3200),
          movementPerMinute: metric(42),
        }),
        heartRateReference: reference(),
      },
      { now },
    )
    expect(progressOf(full)).toEqual({
      oxygen: 96.6,
      temperature: 100,
      steps: 100,
      distance: 100,
      movement: 100,
      resting: 100,
      max: 100,
    })
    // Sem valor, vazio, inclusive quando a legenda ainda diz algo.
    const empty = measurementsViewFrom(withReference(reference({ maxBpm: null })), { now })
    expect(progressOf(empty)).toEqual({
      oxygen: 0,
      temperature: 0,
      steps: 0,
      distance: 0,
      movement: 0,
      resting: 100,
      max: 0,
    })
  })

  it('leitura de demonstração leva o selo de demonstração', () => {
    const view = measurementsViewFrom(reporting({}, 'DEMO'), { now })
    if (view.kind !== 'entries') throw new Error('esperava entradas')
    expect(view.sourceBadge).toBe(DEMO_DATA_LABEL)
  })

  it('leitura real dispensa selo, mesmo com repouso provisório', () => {
    const real = measurementsViewFrom(reporting(), { now })
    if (real.kind !== 'entries') throw new Error('esperava entradas')
    expect(real.sourceBadge).toBeNull()
    // A marca provisória é do esforço e do desgaste; aqui ela já está na
    // legenda do repouso, e repeti-la como selo duplicaria o aviso.
    const provisional = measurementsViewFrom({ ...reporting(), baseline: 'PROVISIONAL' }, { now })
    if (provisional.kind !== 'entries') throw new Error('esperava entradas')
    expect(provisional.sourceBadge).toBeNull()
  })

  it('oxigenação em inteiro com o horário da última medição; sem valor, nada', () => {
    const view = measurementsViewFrom(reporting({ oxygenSaturation: metric(96.6) }), { now })
    expect(entryOf(view, 'oxygen')).toEqual({
      value: '97%',
      caption: `Última medição ${whenLabel(FIXTURE_AT, now)}`,
    })
    expect(entryOf(measurementsViewFrom(reporting(), { now }), 'oxygen')).toEqual(NOTHING)
  })

  it('oxigenação com valor mas sem instante mostra o valor e nenhuma legenda', () => {
    const view = measurementsViewFrom(
      reporting({ oxygenSaturation: metric(97, { measuredAt: null }) }),
      { now },
    )
    expect(entryOf(view, 'oxygen')).toEqual({ value: '97%', caption: null })
  })

  it('temperatura com uma casa em pt-BR e o horário da última medição; sem valor, nada', () => {
    const view = measurementsViewFrom(reporting({ bodyTemperature: metric(36.5) }), { now })
    expect(entryOf(view, 'temperature')).toEqual({
      value: '36,5 °C',
      caption: `Última medição ${whenLabel(FIXTURE_AT, now)}`,
    })
    const whole = measurementsViewFrom(reporting({ bodyTemperature: metric(37) }), { now })
    expect(entryOf(whole, 'temperature').value).toBe('37,0 °C')
    expect(entryOf(measurementsViewFrom(reporting(), { now }), 'temperature')).toEqual(NOTHING)
  })

  it('passos do dia em inteiro com milhar pt-BR; sem valor, nada', () => {
    const view = measurementsViewFrom(reporting({ steps: metric(4230) }), { now })
    expect(entryOf(view, 'steps')).toEqual({ value: '4.230', caption: 'Hoje' })
    expect(entryOf(measurementsViewFrom(reporting(), { now }), 'steps')).toEqual(NOTHING)
  })

  it('distância do dia em km com uma casa, também abaixo de 1 km; sem valor, nada', () => {
    const far = measurementsViewFrom(reporting({ distance: metric(3200) }), { now })
    expect(entryOf(far, 'distance')).toEqual({ value: '3,2 km', caption: 'Hoje' })
    const near = measurementsViewFrom(reporting({ distance: metric(400) }), { now })
    expect(entryOf(near, 'distance')).toEqual({ value: '0,4 km', caption: 'Hoje' })
    expect(entryOf(measurementsViewFrom(reporting(), { now }), 'distance')).toEqual(NOTHING)
  })

  it('movimento por minuto em inteiro; sem taxa mas com horário diz a última amostra; sem nada, nada', () => {
    const view = measurementsViewFrom(reporting({ movementPerMinute: metric(42.4) }), { now })
    expect(entryOf(view, 'movement')).toEqual({ value: '42/min', caption: null })
    const sampled = measurementsViewFrom(
      reporting({ movementPerMinute: { ...none<number>('mpm'), measuredAt: FIXTURE_AT } }),
      { now },
    )
    expect(entryOf(sampled, 'movement')).toEqual({
      value: null,
      caption: `Última amostra ${whenLabel(FIXTURE_AT, now)}`,
    })
    expect(entryOf(measurementsViewFrom(reporting(), { now }), 'movement')).toEqual(NOTHING)
  })

  it('repouso em bpm diz em quantos dias foi medido, no singular com um dia', () => {
    expect(entryOf(measurementsViewFrom(withReference(reference()), { now }), 'resting')).toEqual({
      value: '62 bpm',
      caption: 'Medido em 9 dias',
    })
    const oneDay = withReference(reference({ restingBpm: 61.6, measuredDays: 1 }))
    expect(entryOf(measurementsViewFrom(oneDay, { now }), 'resting')).toEqual({
      value: '62 bpm',
      caption: 'Medido em 1 dia',
    })
  })

  it('repouso provisório leva a marca de estimativa; sem referência, nada', () => {
    const provisional = withReference(
      reference({ restingSource: 'PROVISIONAL', provisionalFrom: 'SESSION', measuredDays: 0 }),
    )
    expect(entryOf(measurementsViewFrom(provisional, { now }), 'resting')).toEqual({
      value: '62 bpm',
      caption: PROVISIONAL_BASELINE_LABEL,
    })
    expect(entryOf(measurementsViewFrom(withReference(null), { now }), 'resting')).toEqual(NOTHING)
    expect(entryOf(measurementsViewFrom(withReference(undefined), { now }), 'resting')).toEqual(
      NOTHING,
    )
  })

  it('máxima arredondada e estimada pela idade; sem data de nascimento, diz isso; sem referência, nada', () => {
    const estimated = withReference(reference({ maxBpm: 180.6 }))
    expect(entryOf(measurementsViewFrom(estimated, { now }), 'max')).toEqual({
      value: '181 bpm',
      caption: 'Estimada pela idade',
    })
    const noBirthDate = withReference(reference({ maxBpm: null }))
    expect(entryOf(measurementsViewFrom(noBirthDate, { now }), 'max')).toEqual({
      value: null,
      caption: 'Sem data de nascimento',
    })
    expect(entryOf(measurementsViewFrom(withReference(null), { now }), 'max')).toEqual(NOTHING)
    expect(entryOf(measurementsViewFrom(withReference(undefined), { now }), 'max')).toEqual(NOTHING)
  })

  it('zero continua zero, nunca vira ausência', () => {
    const view = measurementsViewFrom(
      reporting({ steps: metric(0), distance: metric(0), movementPerMinute: metric(0) }),
      { now },
    )
    expect(entryOf(view, 'steps').value).toBe('0')
    expect(entryOf(view, 'distance').value).toBe('0,0 km')
    expect(entryOf(view, 'movement').value).toBe('0/min')
  })

  // Calibração individual: cada medição leva a zona de agora e a faixa da
  // pessoa. Os totais do dia (passos, distância) só levam a faixa; o
  // movimento é ritmo de agora e leva a zona.
  describe('calibração individual', () => {
    const calibrated: WorkerTelemetry = {
      ...reporting(),
      calibration: {
        version: 'cal-v1',
        phase: 'CALIBRATED',
        recalibrating: false,
        day: null,
        metrics: {
          OXYGEN_SATURATION: {
            zone: 'EXCELLENCE',
            cuts: { excellence: 97, fatigue: 94 },
            source: 'LEARNED',
          },
          BODY_TEMPERATURE: {
            zone: 'NORMAL',
            cuts: { p10: 33.1, p25: 33.5, p75: 34.5, p90: 34.9 },
            source: 'LEARNED',
          },
          STEPS: { zone: 'BELOW', cuts: { below: 8000, above: 11000 }, source: 'LEARNED' },
          DISTANCE: { zone: null, cuts: { below: 5200, above: 7800 }, source: 'LEARNED' },
          MOVEMENT: { zone: 'ABOVE', cuts: { below: 30, above: 52 }, source: 'LEARNED' },
        },
      },
    }
    const lineOf = (key: MeasurementKey) => {
      const view = measurementsViewFrom(calibrated, { now })
      if (view.kind !== 'entries') throw new Error('esperava medições')
      const found = view.entries.find((e) => e.key === key)
      return { zone: found?.zone, limits: found?.limits }
    }

    it('oxigenação, temperatura e movimento levam zona e faixa', () => {
      expect(lineOf('oxygen')).toEqual({
        zone: { label: 'Excelência', status: 'accept' },
        limits: 'excelência a partir de 97%, fadiga abaixo de 94%',
      })
      expect(lineOf('temperature')).toEqual({
        zone: { label: 'Normal', status: 'info' },
        limits: 'habitual de 33,5 a 34,5 °C',
      })
      expect(lineOf('movement')).toEqual({
        zone: { label: 'Acima do habitual', status: 'info' },
        limits: 'habitual: 30 a 52/min',
      })
    })

    it('passos e distância só levam a faixa habitual', () => {
      expect(lineOf('steps')).toEqual({ zone: null, limits: 'habitual: 8 a 11 mil passos' })
      expect(lineOf('distance')).toEqual({ zone: null, limits: 'habitual: 5,2 a 7,8 km' })
    })

    it('repouso e máxima não têm faixa', () => {
      expect(lineOf('resting')).toEqual({ zone: null, limits: null })
      expect(lineOf('max')).toEqual({ zone: null, limits: null })
    })

    it('sem calibração, nenhuma medição leva zona nem faixa', () => {
      const view = measurementsViewFrom(reporting(), { now })
      if (view.kind !== 'entries') throw new Error('esperava medições')
      for (const e of view.entries) {
        expect(e.zone).toBeNull()
        expect(e.limits).toBeNull()
      }
    })
  })
})
