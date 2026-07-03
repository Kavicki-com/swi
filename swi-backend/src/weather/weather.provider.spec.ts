import { mapWeatherCode, coerceOpenMeteo, OpenMeteoProvider } from './weather.provider'

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
    })
  })
  it('lança se faltar current/daily', () => expect(() => coerceOpenMeteo({})).toThrow())
  it('lança se número essencial ausente', () =>
    expect(() => coerceOpenMeteo({ current: {}, daily: { temperature_2m_max: [1], temperature_2m_min: [1] } })).toThrow())
})

describe('OpenMeteoProvider.fetch', () => {
  afterEach(() => jest.restoreAllMocks())
  it('HTTP ok → coerce (+ contrato de URL)', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        current: { temperature_2m: 17, relative_humidity_2m: 65, wind_speed_10m: 65, weather_code: 63 },
        daily: { temperature_2m_max: [32], temperature_2m_min: [19] },
      }),
    } as any)
    expect((await new OpenMeteoProvider().fetch()).current.tempC).toBe(17)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('latitude=-23.55&longitude=-46.63'),
      expect.objectContaining({ signal: expect.anything() }),
    )
    const calledUrl = spy.mock.calls[0][0] as string
    expect(calledUrl).toContain('current=temperature_2m')
    expect(calledUrl).toContain('daily=temperature_2m_max')
  })
  it('HTTP !ok → lança (caller faz fallback)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503 } as any)
    await expect(new OpenMeteoProvider().fetch()).rejects.toThrow()
  })
})
