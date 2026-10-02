import type { SummarizerSample } from '../lifecycle/telemetry-summarizer'
import {
  assembleSeries,
  seriesBuckets,
  type SeriesSummaryRow,
} from './telemetry-series'

// Brasília é UTC-3: o dia monitorado `2026-09-10` vai de `2026-09-10T03:00Z`
// a `2026-09-11T03:00Z`. "Agora" fica no meio da tarde local desse dia.
const NOW = new Date('2026-09-10T18:30:00.000Z')
const DAY_START = new Date('2026-09-10T03:00:00.000Z')
const HOUR = 60 * 60 * 1000

const sample = (iso: string, over: Partial<SummarizerSample> = {}): SummarizerSample => ({
  eventTime: new Date(iso),
  sessionId: 's1',
  heartRateBpm: null,
  stepDelta: null,
  distanceDeltaM: null,
  activeEnergyKcal: null,
  batteryPercent: null,
  systolicMmHg: null,
  diastolicMmHg: null,
  bloodPressureSource: null,
  ...over,
})

const summaryRow = (dayIso: string, over: Partial<SeriesSummaryRow> = {}): SeriesSummaryRow => ({
  day: new Date(`${dayIso}T00:00:00.000Z`),
  heartRateMin: 60,
  heartRateMax: 120,
  heartRateAvg: 88.44,
  stepsTotal: 4200,
  distanceTotalM: 3150.6,
  activeEnergyKcalTotal: 410.26,
  coveredMs: 12 * HOUR,
  ...over,
})

describe('seriesBuckets', () => {
  it('dia: baldes de hora desde a meia-noite de Brasília até a hora corrente', () => {
    const { bucket, buckets } = seriesBuckets('day', NOW)
    expect(bucket).toBe('hour')
    expect(buckets[0].start.toISOString()).toBe(DAY_START.toISOString())
    // 18:30Z é 15:30 em Brasília: a hora das 15 é a 16ª, e a das 16 ainda não começou.
    expect(buckets).toHaveLength(16)
    expect(buckets[15].start.toISOString()).toBe('2026-09-10T18:00:00.000Z')
    expect(buckets[15].end.toISOString()).toBe('2026-09-10T19:00:00.000Z')
  })

  it('dia logo depois da meia-noite local tem um balde só', () => {
    const { buckets } = seriesBuckets('day', new Date('2026-09-10T03:00:00.000Z'))
    expect(buckets).toHaveLength(1)
    expect(buckets[0].start.toISOString()).toBe('2026-09-10T03:00:00.000Z')
  })

  it('um minuto antes da meia-noite local ainda é o dia anterior', () => {
    const { buckets } = seriesBuckets('day', new Date('2026-09-10T02:59:00.000Z'))
    expect(buckets[0].start.toISOString()).toBe('2026-09-09T03:00:00.000Z')
    expect(buckets).toHaveLength(24)
  })

  it('semana e mês: um balde por dia monitorado, terminando no dia de hoje', () => {
    const week = seriesBuckets('week', NOW)
    expect(week.bucket).toBe('day')
    expect(week.buckets).toHaveLength(7)
    expect(week.buckets[0].day.toISOString()).toBe('2026-09-04T00:00:00.000Z')
    expect(week.buckets[6].day.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect(week.buckets[6].start.toISOString()).toBe(DAY_START.toISOString())

    const month = seriesBuckets('month', NOW)
    expect(month.buckets).toHaveLength(30)
    expect(month.buckets[0].day.toISOString()).toBe('2026-08-12T00:00:00.000Z')
  })
})

describe('assembleSeries', () => {
  const base = { workerId: 'w1', now: NOW }

  it('quem nunca reportou recebe os baldes vazios, com origem nula', () => {
    const series = assembleSeries({
      ...base,
      period: 'week',
      origin: null,
      summaries: [],
      samples: [],
      openFrom: DAY_START,
    })
    expect(series.origin).toBeNull()
    expect(series.points).toHaveLength(7)
    for (const p of series.points) {
      expect(p.activeEnergyKcal).toBeNull()
      expect(p.steps).toBeNull()
      expect(p.heartRate).toEqual({ avg: null, min: null, max: null })
      expect(p.coverage).toBe(0)
    }
  })

  it('dia: agrega as amostras de cada hora pela mesma conta do Resumo do dia', () => {
    const series = assembleSeries({
      ...base,
      period: 'day',
      origin: 'REAL',
      summaries: [],
      samples: [
        sample('2026-09-10T12:00:00.000Z', { heartRateBpm: 80, activeEnergyKcal: 1.25, stepDelta: 10 }),
        sample('2026-09-10T12:00:30.000Z', { heartRateBpm: 100, activeEnergyKcal: 1.5, distanceDeltaM: 7.6 }),
        sample('2026-09-10T13:10:00.000Z', { heartRateBpm: 90 }),
      ],
      openFrom: DAY_START,
    })
    const nine = series.points.find((p) => p.start === '2026-09-10T12:00:00.000Z')!
    expect(nine.heartRate).toEqual({ avg: 90, min: 80, max: 100 })
    expect(nine.activeEnergyKcal).toBe(2.8)
    expect(nine.steps).toBe(10)
    expect(nine.distanceM).toBe(8)
    // 30 s cobertos numa hora inteira.
    expect(nine.coverage).toBeCloseTo(30_000 / HOUR, 6)

    const ten = series.points.find((p) => p.start === '2026-09-10T13:00:00.000Z')!
    expect(ten.heartRate.avg).toBe(90)
    // Uma leitura só cobre zero: houve medida, mas nenhum intervalo.
    expect(ten.coverage).toBe(0)
    expect(ten.activeEnergyKcal).toBeNull()
  })

  it('ausência é nula, nunca zero; zero medido continua zero', () => {
    const series = assembleSeries({
      ...base,
      period: 'day',
      origin: 'REAL',
      summaries: [],
      samples: [sample('2026-09-10T12:00:00.000Z', { stepDelta: 0 })],
      openFrom: DAY_START,
    })
    const nine = series.points.find((p) => p.start === '2026-09-10T12:00:00.000Z')!
    expect(nine.steps).toBe(0)
    expect(nine.activeEnergyKcal).toBeNull()
    const eight = series.points.find((p) => p.start === '2026-09-10T11:00:00.000Z')!
    expect(eight.steps).toBeNull()
  })

  it('a hora corrente mede cobertura só sobre o tempo que já passou', () => {
    const series = assembleSeries({
      ...base,
      period: 'day',
      origin: 'REAL',
      summaries: [],
      samples: [
        sample('2026-09-10T18:00:00.000Z', { heartRateBpm: 70 }),
        sample('2026-09-10T18:01:00.000Z', { heartRateBpm: 70 }),
      ],
      openFrom: DAY_START,
    })
    const last = series.points[series.points.length - 1]
    expect(last.start).toBe('2026-09-10T18:00:00.000Z')
    // Um minuto coberto sobre a meia hora já decorrida, e não sobre a hora cheia.
    expect(last.coverage).toBeCloseTo(60_000 / (30 * 60_000), 6)
  })

  it('semana: dia fechado vem do Resumo; dia ainda aberto vem das amostras; dia fechado sem Resumo fica vazio', () => {
    const series = assembleSeries({
      ...base,
      period: 'week',
      origin: 'REAL',
      summaries: [summaryRow('2026-09-05'), summaryRow('2026-09-07', { stepsTotal: 0, distanceTotalM: null })],
      samples: [
        sample('2026-09-09T12:00:00.000Z', { heartRateBpm: 110, activeEnergyKcal: 3 }),
        sample('2026-09-09T12:00:30.000Z', { heartRateBpm: 130, activeEnergyKcal: 2 }),
      ],
      // Dias que começam a partir daqui ainda não têm Resumo.
      openFrom: new Date('2026-09-08T03:00:00.000Z'),
    })
    const byDay = (iso: string) => series.points.find((p) => p.start === iso)!

    const closed = byDay('2026-09-05T03:00:00.000Z')
    expect(closed.activeEnergyKcal).toBe(410.3)
    expect(closed.steps).toBe(4200)
    expect(closed.distanceM).toBe(3151)
    expect(closed.heartRate).toEqual({ avg: 88.4, min: 60, max: 120 })
    expect(closed.coverage).toBeCloseTo(0.5, 6)

    expect(byDay('2026-09-07T03:00:00.000Z').steps).toBe(0)
    expect(byDay('2026-09-07T03:00:00.000Z').distanceM).toBeNull()

    const open = byDay('2026-09-09T03:00:00.000Z')
    expect(open.heartRate).toEqual({ avg: 120, min: 110, max: 130 })
    expect(open.activeEnergyKcal).toBe(5)

    const closedWithoutSummary = byDay('2026-09-06T03:00:00.000Z')
    expect(closedWithoutSummary.heartRate.avg).toBeNull()
    expect(closedWithoutSummary.coverage).toBe(0)
  })

  it('amostra fora da janela da série não entra em balde nenhum', () => {
    const series = assembleSeries({
      ...base,
      period: 'day',
      origin: 'REAL',
      summaries: [],
      samples: [sample('2026-09-10T02:59:59.000Z', { heartRateBpm: 200 })],
      openFrom: DAY_START,
    })
    expect(series.points.every((p) => p.heartRate.max === null)).toBe(true)
  })

  it('devolve a janela da série e a granularidade', () => {
    const series = assembleSeries({
      ...base,
      period: 'week',
      origin: 'DEMO',
      summaries: [],
      samples: [],
      openFrom: DAY_START,
    })
    expect(series).toMatchObject({
      workerId: 'w1',
      period: 'week',
      origin: 'DEMO',
      bucket: 'day',
      from: '2026-09-04T03:00:00.000Z',
      to: NOW.toISOString(),
    })
  })
})
