// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver nota no auth.test.ts).
import {
  pickActiveAlert,
  toWeatherStrip,
  weatherApi,
  type WeatherAlertDto,
  type WeatherSnapshotDto,
} from './weather'

// Só a leitura dos alertas passa pela rede; o resto da suíte é função pura.
const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('./http', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))

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

const NOW = Date.parse(FETCHED_AT)

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

describe('pickActiveAlert', () => {
  it('sem alerta nenhum devolve null', () => {
    expect(pickActiveAlert([], NOW)).toBeNull()
  })

  it('alerta expirado não é vigente', () => {
    const expired = alertWith({ startsAt: hourAt(-3), endsAt: hourAt(-1) })
    expect(pickActiveAlert([expired], NOW)).toBeNull()
  })

  it('alerta que ainda vai começar já vale: a frase do backend traz o horário', () => {
    expect(pickActiveAlert([alertWith()], NOW)?.id).toBe('a1')
  })

  it('PERIGO passa na frente de ATENCAO, mesmo começando depois', () => {
    const attention = alertWith({ id: 'cedo', startsAt: hourAt(0) })
    const danger = alertWith({ id: 'perigo', severity: 'PERIGO', startsAt: hourAt(2) })
    expect(pickActiveAlert([attention, danger], NOW)?.id).toBe('perigo')
  })

  it('no mesmo nível, vence o que começa antes', () => {
    const later = alertWith({ id: 'depois', startsAt: hourAt(2) })
    const sooner = alertWith({ id: 'antes', startsAt: hourAt(0) })
    expect(pickActiveAlert([later, sooner], NOW)?.id).toBe('antes')
  })

  it('alerta sem kind e sem severity (payload antigo) ainda é aceito', () => {
    const legacy = {
      id: 'antigo',
      event: 'Chuva intensa',
      description: 'Chuva forte prevista a partir das 14h.',
      startsAt: hourAt(1),
      endsAt: hourAt(3),
    }
    expect(pickActiveAlert([legacy], NOW)?.id).toBe('antigo')
  })

  it('entrada malformada é descartada em vez de derrubar a tela', () => {
    const noText = { id: 'x', startsAt: hourAt(0), endsAt: hourAt(2) }
    const badEnd = alertWith({ id: 'y', endsAt: 'not-a-date' })
    expect(pickActiveAlert([null, 'lixo', noText, badEnd], NOW)).toBeNull()
    expect(pickActiveAlert(undefined, NOW)).toBeNull()
  })
})

describe('weatherApi.alerts', () => {
  afterEach(() => {
    apiFetchMock.mockReset()
  })

  it('devolve os alertas do snapshot e o aviso de demonstração', async () => {
    apiFetchMock.mockResolvedValue({ ...snapshotWith([]), alerts: [alertWith()], demo: true })
    const res = await weatherApi.alerts()
    expect(apiFetchMock).toHaveBeenCalledWith('/weather')
    expect(res.error).toBeNull()
    expect(res.data?.alerts.map((a) => a.id)).toEqual(['a1'])
    expect(res.data?.demo).toBe(true)
  })

  it('snapshot sem alerts e sem demo (payload antigo) vira lista vazia', async () => {
    apiFetchMock.mockResolvedValue({ fetchedAt: FETCHED_AT })
    const res = await weatherApi.alerts()
    expect(res.data).toEqual({ alerts: [], demo: false })
  })

  it('falha da API vira erro no envelope, sem lançar', async () => {
    apiFetchMock.mockRejectedValue(new Error('Não foi possível conectar ao servidor'))
    const res = await weatherApi.alerts()
    expect(res.data).toBeNull()
    expect(res.error?.message).toBe('Não foi possível conectar ao servidor')
  })
})
