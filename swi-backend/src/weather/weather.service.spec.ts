import { WeatherService } from './weather.service'
import type { OpenMeteoProvider } from './weather.provider'
import { CANNED_CURRENT, CANNED_DAILY, CANNED_HOURLY } from './weather.types'

const provider = (fetch: OpenMeteoProvider['fetch']) => ({ fetch })

describe('WeatherService.getSnapshot', () => {
  const orig = process.env.WEATHER_SCENARIO
  afterEach(() => { if (orig === undefined) delete process.env.WEATHER_SCENARIO; else process.env.WEATHER_SCENARIO = orig })

  it('provider ok → usa dado real', async () => {
    const svc = new WeatherService(provider(async () => ({ current: { tempC: 22, condition: 'clear', humidityPct: 50, windKmh: 10 }, daily: { minC: 15, maxC: 25 }, hourly: [] })))
    expect((await svc.getSnapshot()).current.tempC).toBe(22)
  })
  it('provider falha → fallback canned (nunca quebra)', async () => {
    const svc = new WeatherService(provider(async () => { throw new Error('down') }))
    expect((await svc.getSnapshot()).current).toEqual(CANNED_CURRENT)
  })
  it('getSnapshot inclui hourly do provider no caminho feliz', async () => {
    const svc = new WeatherService(provider(async () => ({
      current: CANNED_CURRENT, daily: CANNED_DAILY,
      hourly: [{ at: '2026-07-23T10:00', tempC: 19, condition: 'clear' }],
    })))
    const snap = await svc.getSnapshot()
    expect(snap.hourly).toEqual([{ at: '2026-07-23T10:00', tempC: 19, condition: 'clear' }])
  })
  it('getSnapshot serve CANNED_HOURLY quando o provider falha', async () => {
    const svc = new WeatherService(provider(async () => { throw new Error('open-meteo down') }))
    const snap = await svc.getSnapshot()
    expect(snap.hourly).toHaveLength(CANNED_HOURLY.length)
    expect(new Date(snap.hourly![0].at).toString()).not.toBe('Invalid Date')
  })
  it('CANNED_HOURLY resolvido ganha isDay coerente com a hora local do slot', async () => {
    const svc = new WeatherService(provider(async () => { throw new Error('open-meteo down') }))
    const snap = await svc.getSnapshot()
    for (const h of snap.hourly!) {
      const hr = new Date(h.at).getHours()
      expect(h.isDay).toBe(hr >= 6 && hr < 18)
    }
  })
  it('getSnapshot serve CANNED_HOURLY quando o provider retorna série vazia', async () => {
    const svc = new WeatherService(provider(async () => ({ current: CANNED_CURRENT, daily: CANNED_DAILY, hourly: [] })))
    expect((await svc.getSnapshot()).hourly).toHaveLength(CANNED_HOURLY.length)
  })
  it('não fabrica alerta em production mesmo com WEATHER_SCENARIO=alert', async () => {
    const origNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.WEATHER_SCENARIO = 'alert'
    try {
      // Alerta fabricado em produção manda gente evacuar sem tempestade
      // nenhuma. A flag é de demonstração e não pode sobreviver ao ambiente.
      const s = await new WeatherService(provider(async () => { throw new Error('x') })).getSnapshot()
      expect(s.alerts).toEqual([])
    } finally {
      process.env.NODE_ENV = origNodeEnv
    }
  })
  it('WEATHER_SCENARIO=alert → 1 alerta vigente (endsAt no futuro)', async () => {
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await new WeatherService(provider(async () => { throw new Error('x') })).getSnapshot()
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0].id).toBe('wx-0')
    expect(new Date(s.alerts[0].endsAt).getTime()).toBeGreaterThan(Date.now())
  })
  it('WEATHER_SCENARIO=normal → sem alerta (prod não fabrica)', async () => {
    process.env.WEATHER_SCENARIO = 'normal'
    expect((await new WeatherService(provider(async () => { throw new Error('x') })).getSnapshot()).alerts).toHaveLength(0)
  })
  it('provider ok + WEATHER_SCENARIO=alert → dado real E alerta vigente (ortogonais)', async () => {
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await new WeatherService(provider(async () => ({ current: { tempC: 22, condition: 'clear', humidityPct: 50, windKmh: 10 }, daily: { minC: 15, maxC: 25 }, hourly: [] }))).getSnapshot()
    expect(s.current.tempC).toBe(22)
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0].id).toBe('wx-0')
  })
})
