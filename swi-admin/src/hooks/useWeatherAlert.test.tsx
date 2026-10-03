// vitest globals (describe/it/expect/vi) via globals: true. Importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { act, renderHook } from '@testing-library/react'
import type { WeatherAlertDto } from '@/services/api/weather'
import { useWeatherAlert, WEATHER_ALERT_REFRESH_MS } from './useWeatherAlert'

const NOW = Date.parse('2026-10-03T12:00:00.000Z')
const hourAt = (offsetH: number): string => new Date(NOW + offsetH * 3_600_000).toISOString()

const alertWith = (over: Partial<WeatherAlertDto> = {}): WeatherAlertDto => ({
  id: 'a1',
  kind: 'CHUVA_INTENSA',
  severity: 'ATENCAO',
  event: 'Chuva intensa',
  description: 'Chuva forte prevista a partir das 14h.',
  startsAt: hourAt(1),
  endsAt: hourAt(3),
  ...over,
})

const alertsMock = vi.fn()

vi.mock('@/services/api/weather', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/weather')>()
  return { ...actual, weatherApi: { ...actual.weatherApi, alerts: () => alertsMock() } }
})

const ok = (alerts: WeatherAlertDto[], demo = false) => ({ data: { alerts, demo }, error: null })

// Deixa a promessa da leitura assentar sem avançar o relógio.
const settle = () => act(async () => {})

describe('useWeatherAlert', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    alertsMock.mockReset()
  })

  it('antes da primeira leitura não há alerta', () => {
    alertsMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useWeatherAlert())
    expect(result.current).toEqual({ alert: null, demo: false })
  })

  it('entrega o alerta vigente, com PERIGO na frente', async () => {
    alertsMock.mockResolvedValue(
      ok([alertWith({ id: 'atencao' }), alertWith({ id: 'perigo', severity: 'PERIGO' })]),
    )
    const { result } = renderHook(() => useWeatherAlert())
    await settle()
    expect(result.current.alert?.id).toBe('perigo')
    expect(result.current.demo).toBe(false)
  })

  it('alerta de demonstração chega marcado', async () => {
    alertsMock.mockResolvedValue(ok([alertWith()], true))
    const { result } = renderHook(() => useWeatherAlert())
    await settle()
    expect(result.current).toMatchObject({ alert: { id: 'a1' }, demo: true })
  })

  it('sem alerta vigente, a marca de demonstração não sobra sozinha', async () => {
    alertsMock.mockResolvedValue(ok([], true))
    const { result } = renderHook(() => useWeatherAlert())
    await settle()
    expect(result.current).toEqual({ alert: null, demo: false })
  })

  it('relê a cada 5 minutos e troca o alerta', async () => {
    alertsMock.mockResolvedValue(ok([]))
    const { result } = renderHook(() => useWeatherAlert())
    await settle()
    expect(result.current.alert).toBeNull()

    alertsMock.mockResolvedValue(ok([alertWith({ id: 'novo' })]))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEATHER_ALERT_REFRESH_MS)
    })
    expect(alertsMock).toHaveBeenCalledTimes(2)
    expect(result.current.alert?.id).toBe('novo')
  })

  it('falha na releitura mantém o último alerta até ele expirar', async () => {
    alertsMock.mockResolvedValue(ok([alertWith({ endsAt: hourAt(0.1) })]))
    const { result } = renderHook(() => useWeatherAlert())
    await settle()
    expect(result.current.alert?.id).toBe('a1')

    alertsMock.mockResolvedValue({ data: null, error: { message: 'fora do ar' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEATHER_ALERT_REFRESH_MS)
    })
    // 5 minutos depois o alerta (6 minutos de validade) ainda vale.
    expect(result.current.alert?.id).toBe('a1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEATHER_ALERT_REFRESH_MS)
    })
    // 10 minutos depois expirou, mesmo sem leitura nova.
    expect(result.current.alert).toBeNull()
  })

  it('desmontar para a releitura', async () => {
    alertsMock.mockResolvedValue(ok([]))
    const { unmount } = renderHook(() => useWeatherAlert())
    await settle()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WEATHER_ALERT_REFRESH_MS * 2)
    })
    expect(alertsMock).toHaveBeenCalledTimes(1)
  })
})
