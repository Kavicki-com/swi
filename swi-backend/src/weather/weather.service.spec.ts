import { WeatherService } from './weather.service'
import type { OpenMeteoProvider } from './weather.provider'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { CANNED_CURRENT, CANNED_DAILY, CANNED_HOURLY, SITE_LOCATION } from './weather.types'

const provider = (fetch: OpenMeteoProvider['fetch']) => ({ fetch })

// Sem empresa na chamada o serviço nem consulta o banco; o dublê fica vazio.
const mkService = (p: { fetch: OpenMeteoProvider['fetch'] }) => new WeatherService(p, {} as never)

describe('WeatherService.getSnapshot', () => {
  const orig = process.env.WEATHER_SCENARIO
  afterEach(() => { if (orig === undefined) delete process.env.WEATHER_SCENARIO; else process.env.WEATHER_SCENARIO = orig })

  it('provider ok → usa dado real', async () => {
    const svc = mkService(provider(async () => ({ current: { tempC: 22, condition: 'clear', humidityPct: 50, windKmh: 10 }, daily: { minC: 15, maxC: 25 }, hourly: [] })))
    expect((await svc.getSnapshot()).current.tempC).toBe(22)
  })
  it('provider falha → fallback canned (nunca quebra)', async () => {
    const svc = mkService(provider(async () => { throw new Error('down') }))
    expect((await svc.getSnapshot()).current).toEqual(CANNED_CURRENT)
  })
  it('getSnapshot inclui hourly do provider no caminho feliz', async () => {
    const svc = mkService(provider(async () => ({
      current: CANNED_CURRENT, daily: CANNED_DAILY,
      hourly: [{ at: '2026-07-23T10:00', tempC: 19, condition: 'clear' }],
    })))
    const snap = await svc.getSnapshot()
    expect(snap.hourly).toEqual([{ at: '2026-07-23T10:00', tempC: 19, condition: 'clear' }])
  })
  it('getSnapshot serve CANNED_HOURLY quando o provider falha', async () => {
    const svc = mkService(provider(async () => { throw new Error('open-meteo down') }))
    const snap = await svc.getSnapshot()
    expect(snap.hourly).toHaveLength(CANNED_HOURLY.length)
    expect(new Date(snap.hourly![0].at).toString()).not.toBe('Invalid Date')
  })
  it('CANNED_HOURLY resolvido ganha isDay coerente com a hora local do slot', async () => {
    const svc = mkService(provider(async () => { throw new Error('open-meteo down') }))
    const snap = await svc.getSnapshot()
    for (const h of snap.hourly!) {
      const hr = new Date(h.at).getHours()
      expect(h.isDay).toBe(hr >= 6 && hr < 18)
    }
  })
  it('getSnapshot serve CANNED_HOURLY quando o provider retorna série vazia', async () => {
    const svc = mkService(provider(async () => ({ current: CANNED_CURRENT, daily: CANNED_DAILY, hourly: [] })))
    expect((await svc.getSnapshot()).hourly).toHaveLength(CANNED_HOURLY.length)
  })
  it('não fabrica alerta em production mesmo com WEATHER_SCENARIO=alert', async () => {
    const origNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.WEATHER_SCENARIO = 'alert'
    try {
      // Alerta fabricado em produção manda gente evacuar sem tempestade
      // nenhuma. A flag é de demonstração e não pode sobreviver ao ambiente.
      const s = await mkService(provider(async () => { throw new Error('x') })).getSnapshot()
      expect(s.alerts).toEqual([])
    } finally {
      process.env.NODE_ENV = origNodeEnv
    }
  })
  it('WEATHER_SCENARIO=alert → 1 alerta vigente (endsAt no futuro)', async () => {
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await mkService(provider(async () => { throw new Error('x') })).getSnapshot()
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0].id).toBe('wx-0')
    expect(new Date(s.alerts[0].endsAt).getTime()).toBeGreaterThan(Date.now())
  })
  it('WEATHER_SCENARIO=normal → sem alerta (prod não fabrica)', async () => {
    process.env.WEATHER_SCENARIO = 'normal'
    expect((await mkService(provider(async () => { throw new Error('x') })).getSnapshot()).alerts).toHaveLength(0)
  })
  it('provider ok + WEATHER_SCENARIO=alert → dado real E alerta vigente (ortogonais)', async () => {
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await mkService(provider(async () => ({ current: { tempC: 22, condition: 'clear', humidityPct: 50, windKmh: 10 }, daily: { minC: 15, maxC: 25 }, hourly: [] }))).getSnapshot()
    expect(s.current.tempC).toBe(22)
    expect(s.alerts).toHaveLength(1)
    expect(s.alerts[0].id).toBe('wx-0')
  })
})

// Leitura real mínima, com uma hora de previsão de risco no instante dado.
const reading = (tempC: number, hazardAt?: string, code = 1) => ({
  current: { tempC, condition: 'clear' as const, humidityPct: 50, windKmh: 10 },
  daily: { minC: 15, maxC: 25 },
  hourly: [{ at: '2026-03-10T09:00', tempC, condition: 'clear' as const }],
  utcOffsetSeconds: -3 * 3600,
  hazards: hazardAt === undefined ? undefined : [{
    at: hazardAt, precipitationMm: 0, precipitationProbabilityPct: 0, weatherCode: code,
    uvIndex: 2, apparentTempC: 25, windGustsKmh: 10, isDay: true,
  }],
})

const NOW = new Date('2026-03-10T12:30:00.000Z')
const later = (min: number) => new Date(NOW.getTime() + min * 60_000)

describe('WeatherService: local por empresa', () => {
  it('sem empresa lê o local padrão, sem consultar o banco', async () => {
    const fetch = jest.fn(async () => reading(20))
    await mkService({ fetch }).getSnapshot()
    expect(fetch).toHaveBeenCalledWith(SITE_LOCATION)
  })

  it('empresa com local informado lê o local dela', async () => {
    const fetch = jest.fn(async () => reading(20))
    const findUnique = jest.fn().mockResolvedValue({ lat: -3.1, lng: -60.02 })
    const svc = new WeatherService({ fetch }, { company: { findUnique } } as never)
    await svc.getSnapshot('c1')
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'c1' }, select: { lat: true, lng: true } })
    expect(fetch).toHaveBeenCalledWith({ lat: -3.1, lng: -60.02 })
  })

  it('empresa sem local informado cai no local padrão', async () => {
    const fetch = jest.fn(async () => reading(20))
    const svc = new WeatherService({ fetch }, { company: { findUnique: jest.fn().mockResolvedValue({ lat: null, lng: null }) } } as never)
    await svc.getSnapshot('c1')
    expect(fetch).toHaveBeenCalledWith(SITE_LOCATION)
  })
})

describe('WeatherService.snapshotAt: leitura guardada', () => {
  it('leitura recente do mesmo local é reaproveitada, sem nova chamada', async () => {
    const fetch = jest.fn(async () => reading(20))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    const s = await svc.snapshotAt(SITE_LOCATION, later(5))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(s.fetchedAt).toBe(NOW.toISOString())
    expect(s.stale).toBe(false)
  })

  it('passado o prazo da leitura recente, consulta de novo', async () => {
    const fetch = jest.fn(async () => reading(20))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    await svc.snapshotAt(SITE_LOCATION, later(11))
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fonte fora do ar repete a última leitura boa, marcada como velha', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(reading(23)).mockRejectedValue(new Error('down'))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    const s = await svc.snapshotAt(SITE_LOCATION, later(30))
    expect(s.current.tempC).toBe(23)
    expect(s).toMatchObject({ stale: true, unavailable: false, fetchedAt: NOW.toISOString() })
  })

  it('leitura boa velha demais não é repetida: a resposta fica indisponível', async () => {
    const fetch = jest.fn().mockResolvedValueOnce(reading(23)).mockRejectedValue(new Error('down'))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    const s = await svc.snapshotAt(SITE_LOCATION, later(7 * 60))
    expect(s.current).toEqual(CANNED_CURRENT)
    expect(s).toMatchObject({ stale: false, unavailable: true })
  })

  it('sem nenhuma leitura boa, a resposta de reserva sai marcada como indisponível', async () => {
    const s = await mkService(provider(async () => { throw new Error('down') })).snapshotAt(SITE_LOCATION, NOW)
    expect(s).toMatchObject({ stale: false, unavailable: true, demo: false, alerts: [] })
    expect(s.fetchedAt).toBe(NOW.toISOString())
  })

  it('locais diferentes não dividem a leitura', async () => {
    const fetch = jest.fn(async () => reading(20))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    await svc.snapshotAt({ lat: -3.1, lng: -60.02 }, NOW)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('WeatherService: alertas reais', () => {
  const origNodeEnv = process.env.NODE_ENV
  const origScenario = process.env.WEATHER_SCENARIO
  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv
    if (origScenario === undefined) delete process.env.WEATHER_SCENARIO
    else process.env.WEATHER_SCENARIO = origScenario
  })

  it('em produção, a previsão de tempestade vira alerta real', async () => {
    process.env.NODE_ENV = 'production'
    const svc = mkService(provider(async () => reading(20, '2026-03-10T13:00:00.000Z', 95)))
    const s = await svc.snapshotAt(SITE_LOCATION, NOW)
    expect(s.alerts.map((a) => a.kind)).toEqual(['TEMPESTADE'])
    expect(s.demo).toBe(false)
  })

  it('leitura velha ainda alerta: a previsão de risco não some com a queda da fonte', async () => {
    process.env.NODE_ENV = 'production'
    const fetch = jest.fn().mockResolvedValueOnce(reading(20, '2026-03-10T13:00:00.000Z', 95)).mockRejectedValue(new Error('down'))
    const svc = mkService({ fetch })
    await svc.snapshotAt(SITE_LOCATION, NOW)
    const s = await svc.snapshotAt(SITE_LOCATION, later(20))
    expect(s.stale).toBe(true)
    expect(s.alerts.map((a) => a.kind)).toEqual(['TEMPESTADE'])
  })

  it('alerta de demonstração soma aos reais e marca a resposta', async () => {
    process.env.NODE_ENV = 'test'
    process.env.WEATHER_SCENARIO = 'alert'
    const s = await mkService(provider(async () => reading(20, '2026-03-10T13:00:00.000Z', 95))).snapshotAt(SITE_LOCATION, NOW)
    expect(s.alerts.map((a) => a.id)).toEqual(['wx:TEMPESTADE:2026-03-10T13:00:00.000Z', 'wx-0'])
    expect(s.demo).toBe(true)
  })

  it('alertsAt devolve só os reais, nunca o de demonstração', async () => {
    process.env.NODE_ENV = 'test'
    process.env.WEATHER_SCENARIO = 'alert'
    const svc = mkService(provider(async () => reading(20, '2026-03-10T13:00:00.000Z', 95)))
    expect((await svc.alertsAt(SITE_LOCATION, NOW)).map((a) => a.kind)).toEqual(['TEMPESTADE'])
  })

  it('alertsAt com a fonte fora do ar e sem leitura boa não alerta, e não lança', async () => {
    const svc = mkService(provider(async () => { throw new Error('down') }))
    await expect(svc.alertsAt(SITE_LOCATION, NOW)).resolves.toEqual([])
  })

  it('demoAlerts só existe fora de produção e com a flag', () => {
    const svc = mkService(provider(async () => reading(20)))
    process.env.NODE_ENV = 'test'
    process.env.WEATHER_SCENARIO = 'alert'
    expect(svc.demoAlerts(NOW)).toEqual([expect.objectContaining({ id: 'wx-0', kind: 'TEMPESTADE', severity: 'PERIGO' })])
    process.env.NODE_ENV = 'production'
    expect(svc.demoAlerts(NOW)).toEqual([])
  })
})

describe('WeatherService: local configurável da empresa', () => {
  const mkPrisma = (row: { lat: number | null; lng: number | null } | null) => ({
    company: {
      findUnique: jest.fn().mockResolvedValue(row),
      update: jest.fn(async ({ data }: { data: { lat: number | null; lng: number | null } }) => data),
    },
  })
  const svcWith = (prisma: ReturnType<typeof mkPrisma>) =>
    new WeatherService(provider(async () => reading(20)), prisma as never)

  it('local informado sai como configurado', async () => {
    const out = await svcWith(mkPrisma({ lat: -3.1, lng: -60.02 })).getLocation('c1')
    expect(out).toEqual({ lat: -3.1, lng: -60.02, configured: true })
  })

  it('sem local informado devolve o padrão, como não configurado', async () => {
    const out = await svcWith(mkPrisma({ lat: null, lng: null })).getLocation('c1')
    expect(out).toEqual({ ...SITE_LOCATION, configured: false })
  })

  it('grava o local da empresa do requisitante', async () => {
    const prisma = mkPrisma({ lat: null, lng: null })
    const out = await svcWith(prisma).setLocation('c1', { lat: -3.1, lng: -60.02 })
    expect(prisma.company.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { lat: -3.1, lng: -60.02 }, select: { lat: true, lng: true } })
    expect(out).toEqual({ lat: -3.1, lng: -60.02, configured: true })
  })

  it('limpar o local volta ao padrão', async () => {
    const prisma = mkPrisma({ lat: -3.1, lng: -60.02 })
    const out = await svcWith(prisma).resetLocation('c1')
    expect(prisma.company.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { lat: null, lng: null }, select: { lat: true, lng: true } })
    expect(out).toEqual({ ...SITE_LOCATION, configured: false })
  })

  it('administrador sem empresa não tem local a configurar', async () => {
    const svc = svcWith(mkPrisma(null))
    await expect(svc.getLocation(null)).rejects.toThrow(ForbiddenException)
    await expect(svc.setLocation(null, { lat: 0, lng: 0 })).rejects.toThrow(ForbiddenException)
    await expect(svc.resetLocation(null)).rejects.toThrow(ForbiddenException)
  })

  it('empresa inexistente responde não encontrada', async () => {
    await expect(svcWith(mkPrisma(null)).getLocation('c-x')).rejects.toThrow(NotFoundException)
  })
})
