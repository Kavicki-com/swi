// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver nota no auth.test.ts).
import { toWeatherStrip, type WeatherSnapshotDto } from './weather'

// Base fetchedAt fixo pra os testes deterministas. Os `at` das horas são
// derivados dele + offset em horas.
const FETCHED_AT = '2026-07-23T12:00:00.000Z'
const hourAt = (offsetH: number): string =>
  new Date(Date.parse(FETCHED_AT) + offsetH * 3_600_000).toISOString()

const snapshotWith = (
  hourly: WeatherSnapshotDto['hourly'],
  fetchedAt = FETCHED_AT,
): WeatherSnapshotDto => ({
  current: { tempC: 20, condition: 'clear', humidityPct: 50, windKmh: 10 },
  daily: { minC: 15, maxC: 28 },
  hourly,
  alerts: [],
  fetchedAt,
})

describe('toWeatherStrip', () => {
  it('selects 4 slots nearest to fetchedAt + [-4h, 0, +2h, +4h] with isNow only on offset 0', () => {
    const snap = snapshotWith([
      { at: hourAt(-4), tempC: 16, condition: 'rain' },
      { at: hourAt(-2), tempC: 17, condition: 'clouds' },
      { at: hourAt(0), tempC: 18, condition: 'storm' },
      { at: hourAt(2), tempC: 19, condition: 'clouds' },
      { at: hourAt(4), tempC: 20, condition: 'clear' },
    ])
    const strip = toWeatherStrip(snap)
    expect(strip).toHaveLength(4)
    // offsets: -4h → rain slot, 0 → storm slot, +2h → clouds slot, +4h → clear slot
    expect(strip.map((s) => s.at)).toEqual([hourAt(-4), hourAt(0), hourAt(2), hourAt(4)])
    expect(strip.map((s) => s.tempC)).toEqual([16, 18, 19, 20])
    // isNow só no slot do offset 0
    expect(strip.map((s) => s.isNow ?? false)).toEqual([false, true, false, false])
  })

  it('fetchedAt inválido → [] (degradação graciosa, sem slots NaN)', () => {
    const snap = snapshotWith(
      [
        { at: hourAt(-4), tempC: 16, condition: 'rain' },
        { at: hourAt(0), tempC: 18, condition: 'clear' },
      ],
      'not-a-date',
    )
    expect(toWeatherStrip(snap)).toEqual([])
  })

  it('série esparsa não duplica slots: dedup por hora resolvida, preservando isNow', () => {
    // 1 entrada só → os 4 offsets resolvem todos pra mesma hora.
    const snap = snapshotWith([{ at: hourAt(0), tempC: 18, condition: 'clear' }])
    const strip = toWeatherStrip(snap)
    expect(strip).toHaveLength(1)
    expect(strip[0]?.at).toBe(hourAt(0))
    expect(strip[0]?.isNow).toBe(true)
  })

  it('propaga isNight a partir do isDay do backend (false → noite, true → dia)', () => {
    const snap = snapshotWith([
      { at: hourAt(-4), tempC: 16, condition: 'clear', isDay: true },
      { at: hourAt(0), tempC: 18, condition: 'clear', isDay: true },
      { at: hourAt(2), tempC: 17, condition: 'clouds', isDay: false },
      { at: hourAt(4), tempC: 16, condition: 'rain', isDay: false },
    ])
    const strip = toWeatherStrip(snap)
    expect(strip.map((s) => s.isNight ?? false)).toEqual([false, false, true, true])
  })

  it('sem isDay no payload (backend antigo) → isNight omitido, nunca inventa noite', () => {
    const snap = snapshotWith([
      { at: hourAt(-4), tempC: 16, condition: 'rain' },
      { at: hourAt(0), tempC: 18, condition: 'clear' },
      { at: hourAt(2), tempC: 19, condition: 'clouds' },
      { at: hourAt(4), tempC: 20, condition: 'storm' },
    ])
    for (const slot of toWeatherStrip(snap)) {
      expect(slot.isNight).toBeUndefined()
    }
  })

  it('maps conditions: clear → sun, clouds/fog → cloudy, rain/snow → rain, storm → storm', () => {
    const snap = snapshotWith([
      { at: hourAt(-4), tempC: 16, condition: 'snow' }, // → rain
      { at: hourAt(0), tempC: 18, condition: 'fog' }, // → cloudy
      { at: hourAt(2), tempC: 19, condition: 'storm' }, // → storm
      { at: hourAt(4), tempC: 20, condition: 'clouds' }, // → cloudy
    ])
    const strip = toWeatherStrip(snap)
    expect(strip.map((s) => s.condition)).toEqual(['rain', 'cloudy', 'storm', 'cloudy'])
  })

  it('derives the PT-BR label from the mapped condition (spec parity)', () => {
    const snap = snapshotWith([
      { at: hourAt(-4), tempC: 16, condition: 'rain' },
      { at: hourAt(0), tempC: 18, condition: 'clear' },
      { at: hourAt(2), tempC: 19, condition: 'clouds' },
      { at: hourAt(4), tempC: 20, condition: 'storm' },
    ])
    const strip = toWeatherStrip(snap)
    expect(strip.map((s) => s.label)).toEqual([
      'CHUVAS\nMODERADAS',
      'SOL\nINTENSO',
      'PARCIALMENTE\nNUBLADO',
      'TEMPESTADE',
    ])
  })

  it('picks the hour closest to each target even when times are offset', () => {
    // Horas cheias deslocadas — o alvo -4h (08:00) deve escolher a hora mais
    // próxima (07:50), não a de 06:00.
    const snap = snapshotWith([
      { at: '2026-07-23T06:00:00.000Z', tempC: 10, condition: 'rain' },
      { at: '2026-07-23T07:50:00.000Z', tempC: 16, condition: 'clear' },
      { at: hourAt(0), tempC: 18, condition: 'clear' },
      { at: hourAt(2), tempC: 19, condition: 'clear' },
      { at: hourAt(4), tempC: 20, condition: 'clear' },
    ])
    const strip = toWeatherStrip(snap)
    expect(strip[0]!.at).toBe('2026-07-23T07:50:00.000Z')
    expect(strip[0]!.tempC).toBe(16)
  })

  it('falls back to an empty strip when hourly is missing or empty (no crash)', () => {
    expect(toWeatherStrip(snapshotWith(undefined))).toEqual([])
    expect(toWeatherStrip(snapshotWith([]))).toEqual([])
  })
})
