// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { positionsApi, toDashboardMarker, type PositionMarkerDto } from './positions'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

const TIER_TO_STATUS = { excelente: 'good', desgastado: 'alert', 'alerta-fadiga': 'low' } as const
const statusEsperado = (id: string) => TIER_TO_STATUS[simulatedVitalsFor(id, Date.now()).tier]

const dto = (over: Partial<PositionMarkerDto> = {}): PositionMarkerDto => ({
  id: 'w1',
  name: 'João Silva',
  lat: -23.5505,
  lng: -46.6333,
  sector: 'Torre A',
  avatar: 'http://minio/presigned/w1.jpg',
  recordedAt: '2026-07-25T12:00:00.000Z',
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('toDashboardMarker', () => {
  it('mapeia o dto do backend pro shape que o pino do mapa consome', () => {
    expect(toDashboardMarker(dto())).toEqual({
      id: 'w1',
      name: 'João Silva',
      lat: -23.5505,
      lng: -46.6333,
      // Borda do pino deriva do MESMO gerador de vitais do resto do app.
      status: statusEsperado('w1'),
      avatarUri: 'http://minio/presigned/w1.jpg',
    })
  })

  // Com status fixo em 'good' o mapa de alertas pintaria todo mundo de verde
  // enquanto o dashboard, ao lado, conta desgastados e alertas de fadiga.
  it('reflete o tier do worker no pino, não é verde pra todo mundo', () => {
    const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10']
    const statuses = ids.map((id) => toDashboardMarker(dto({ id })).status)
    // Cada pino concorda com o tier do gerador…
    ids.forEach((id, i) => expect(statuses[i]).toBe(statusEsperado(id)))
    // …e a paleta não colapsa num único valor.
    expect(new Set(statuses).size).toBeGreaterThan(1)
  })

  // Tier sai de hash(id) puro, sem componente temporal: o pino não pode trocar
  // de cor a cada tick do heartbeat (3 s).
  it('mantém o status estável entre ticks do mesmo worker', () => {
    const a = toDashboardMarker(dto({ lat: -23.55 })).status
    const b = toDashboardMarker(dto({ lat: -23.56 })).status
    expect(a).toBe(b)
  })
})

describe('positionsApi.list', () => {
  it('GET /positions e devolve os markers mapeados no envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [dto(), dto({ id: 'w2', name: 'Maria', avatar: '' })],
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await positionsApi.list()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/positions'), expect.anything())
    expect(res.error).toBeNull()
    expect(res.data).toHaveLength(2)
    expect(res.data?.[0]).toMatchObject({ id: 'w1', status: statusEsperado('w1') })
    expect(res.data?.[1]).toMatchObject({ id: 'w2', avatarUri: '' })
  })

  it('falha de rede degrada pra envelope de erro (sem lançar)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const res = await positionsApi.list()

    expect(res.data).toBeNull()
    expect(res.error?.message).toBeTruthy()
  })
})
