import * as httpGet from '../common/httpGet'
import { mapWeatherCode, coerceOpenMeteo, coerceHazards, OpenMeteoProvider } from './weather.provider'

describe('mapWeatherCode (WMO → enum)', () => {
  it.each([[0, 'clear'], [2, 'clouds'], [4, 'clouds'], [45, 'fog'], [63, 'rain'], [81, 'rain'], [75, 'snow'], [95, 'storm']] as const)(
    'code %i → %s', (code, cond) => expect(mapWeatherCode(code)).toBe(cond),
  )
})

describe('coerceOpenMeteo', () => {
  const raw = {
    current: { temperature_2m: 21.6, relative_humidity_2m: 70.2, wind_speed_10m: 12.4, weather_code: 63 },
    daily: { temperature_2m_max: [28.1], temperature_2m_min: [18.9] },
  }
  it('mapeia + arredonda', () => {
    expect(coerceOpenMeteo(raw)).toEqual({
      current: { tempC: 22, condition: 'rain', humidityPct: 70, windKmh: 12 },
      daily: { maxC: 28, minC: 19 },
      hourly: [],
    })
  })
  it('lança se faltar current/daily', () => expect(() => coerceOpenMeteo({})).toThrow())
  it('lança se número essencial ausente', () =>
    expect(() => coerceOpenMeteo({ current: {}, daily: { temperature_2m_max: [1], temperature_2m_min: [1] } })).toThrow())

  it('coerceOpenMeteo extrai série horária (time[] + temperature_2m[] + weather_code[] + is_day[])', () => {
    const raw = {
      current: { temperature_2m: 17.2, relative_humidity_2m: 65, wind_speed_10m: 64.5, weather_code: 61 },
      daily: { temperature_2m_max: [32.1], temperature_2m_min: [19.4] },
      hourly: {
        time: ['2026-07-23T09:00', '2026-07-23T22:00'],
        temperature_2m: [16.6, 18.9],
        weather_code: [3, 0],
        is_day: [1, 0],
      },
    }
    const out = coerceOpenMeteo(raw)
    expect(out.hourly).toEqual([
      { at: '2026-07-23T09:00', tempC: 17, condition: 'clouds', isDay: true },
      { at: '2026-07-23T22:00', tempC: 19, condition: 'clear', isDay: false },
    ])
  })

  it('coerceOpenMeteo tolera hourly sem is_day (isDay omitido)', () => {
    const raw = {
      current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 64, weather_code: 61 },
      daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
      hourly: {
        time: ['2026-07-23T09:00'],
        temperature_2m: [16.6],
        weather_code: [3],
      },
    }
    expect(coerceOpenMeteo(raw).hourly).toEqual([
      { at: '2026-07-23T09:00', tempC: 17, condition: 'clouds' },
    ])
  })

  it('coerceOpenMeteo tolera payload sem hourly (hourly = [])', () => {
    const raw = {
      current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 64, weather_code: 61 },
      daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
    }
    expect(coerceOpenMeteo(raw).hourly).toEqual([])
  })
})

describe('OpenMeteoProvider.fetch', () => {
  afterEach(() => jest.restoreAllMocks())
  it('HTTP ok → coerce (+ contrato de URL)', async () => {
    const spy = jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 65, weather_code: 63 },
        daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
      }),
    } as any)
    expect((await new OpenMeteoProvider().fetch()).current.tempC).toBe(17)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('latitude=-23.55&longitude=-46.63'),
      5000,
    )
    const calledUrl = spy.mock.calls[0][0]
    expect(calledUrl).toContain('current=temperature_2m')
    expect(calledUrl).toContain('daily=temperature_2m_max')
    expect(calledUrl).toContain('hourly=temperature_2m,weather_code,is_day')
    expect(calledUrl).toContain('past_days=1')
  })
  it('HTTP !ok → lança (caller faz fallback)', async () => {
    jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({ ok: false, status: 503 } as any)
    await expect(new OpenMeteoProvider().fetch()).rejects.toThrow()
  })
})

describe('coerceHazards', () => {
  it('converte a hora local do provedor para UTC pelo deslocamento do fuso', () => {
    const out = coerceHazards({
      utc_offset_seconds: -10800,
      hourly: {
        time: ['2026-03-10T09:00'],
        precipitation: [12.5],
        precipitation_probability: [80],
        weather_code: [95],
        uv_index: [8.4],
        apparent_temperature: [31.2],
        wind_gusts_10m: [40],
        is_day: [1],
      },
    })
    expect(out.utcOffsetSeconds).toBe(-10800)
    expect(out.hazards).toEqual([
      {
        at: '2026-03-10T12:00:00.000Z',
        precipitationMm: 12.5,
        precipitationProbabilityPct: 80,
        weatherCode: 95,
        uvIndex: 8.4,
        apparentTempC: 31.2,
        windGustsKmh: 40,
        isDay: true,
      },
    ])
  })

  it('campo que o provedor não entrega vira null, nunca zero', () => {
    const [h] = coerceHazards({ utc_offset_seconds: 0, hourly: { time: ['2026-03-10T09:00'], precipitation: [null] } }).hazards
    expect(h).toEqual({
      at: '2026-03-10T09:00:00.000Z',
      precipitationMm: null,
      precipitationProbabilityPct: null,
      weatherCode: null,
      uvIndex: null,
      apparentTempC: null,
      windGustsKmh: null,
      isDay: null,
    })
  })

  it('payload sem série horária não tem previsão de risco, e não lança', () => {
    expect(coerceHazards({}).hazards).toEqual([])
    expect(coerceHazards(null).hazards).toEqual([])
  })

  it('hora ilegível fica fora, sem derrubar as outras', () => {
    const out = coerceHazards({ utc_offset_seconds: 0, hourly: { time: ['lixo', '2026-03-10T10:00'] } })
    expect(out.hazards.map((h) => h.at)).toEqual(['2026-03-10T10:00:00.000Z'])
  })
})

describe('OpenMeteoProvider.fetch: previsão de risco e conta contratada', () => {
  const payload = {
    utc_offset_seconds: -10800,
    current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 65, weather_code: 63 },
    daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
    hourly: {
      time: Array.from({ length: 72 }, (_, i) => `2026-03-${String(9 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 72 }, () => 20),
      weather_code: Array.from({ length: 72 }, () => 1),
      is_day: Array.from({ length: 72 }, () => 1),
      uv_index: Array.from({ length: 72 }, () => 9),
    },
  }
  const origBase = process.env.OPEN_METEO_BASE_URL
  const origKey = process.env.OPEN_METEO_API_KEY
  afterEach(() => {
    jest.restoreAllMocks()
    if (origBase === undefined) delete process.env.OPEN_METEO_BASE_URL
    else process.env.OPEN_METEO_BASE_URL = origBase
    if (origKey === undefined) delete process.env.OPEN_METEO_API_KEY
    else process.env.OPEN_METEO_API_KEY = origKey
  })
  const spyOk = () => jest.spyOn(httpGet, 'httpGetJson').mockResolvedValue({ ok: true, json: async () => payload } as any)

  it('pede os campos das regras e dois dias de previsão', async () => {
    const spy = spyOk()
    await new OpenMeteoProvider().fetch({ lat: -3.1, lng: -60.02 })
    const url = spy.mock.calls[0][0]
    expect(url).toContain('latitude=-3.1&longitude=-60.02')
    for (const field of ['precipitation', 'precipitation_probability', 'uv_index', 'apparent_temperature', 'wind_gusts_10m']) {
      expect(url).toContain(field)
    }
    expect(url).toContain('forecast_days=2')
  })

  it('a série horária da tela segue com ontem e hoje; a de risco leva tudo', async () => {
    spyOk()
    const out = await new OpenMeteoProvider().fetch()
    expect(out.hourly).toHaveLength(48)
    expect(out.hazards).toHaveLength(72)
    expect(out.utcOffsetSeconds).toBe(-10800)
  })

  it('sem configuração usa o endereço público, sem chave', async () => {
    delete process.env.OPEN_METEO_BASE_URL
    delete process.env.OPEN_METEO_API_KEY
    const spy = spyOk()
    await new OpenMeteoProvider().fetch()
    expect(spy.mock.calls[0][0]).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/)
    expect(spy.mock.calls[0][0]).not.toContain('apikey')
  })

  it('com endereço e chave do plano contratado, usa os dois', async () => {
    process.env.OPEN_METEO_BASE_URL = 'https://customer-api.open-meteo.com/'
    process.env.OPEN_METEO_API_KEY = 'chave de teste'
    const spy = spyOk()
    await new OpenMeteoProvider().fetch()
    expect(spy.mock.calls[0][0]).toMatch(/^https:\/\/customer-api\.open-meteo\.com\/v1\/forecast\?/)
    expect(spy.mock.calls[0][0]).toContain('&apikey=chave%20de%20teste')
  })
})
