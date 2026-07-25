// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { positionsApi, toDashboardMarker, type PositionMarkerDto } from './positions'

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
      // Borda do pino deriva de VITAIS (smartband) — até lá, neutro 'good'.
      status: 'good',
      avatarUri: 'http://minio/presigned/w1.jpg',
    })
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
    expect(res.data?.[0]).toMatchObject({ id: 'w1', status: 'good' })
    expect(res.data?.[1]).toMatchObject({ id: 'w2', avatarUri: '' })
  })

  it('falha de rede degrada pra envelope de erro (sem lançar)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const res = await positionsApi.list()

    expect(res.data).toBeNull()
    expect(res.error?.message).toBeTruthy()
  })
})
