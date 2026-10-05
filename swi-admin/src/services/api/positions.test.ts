// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import {
  markerStatusFor,
  positionsApi,
  toDashboardMarker,
  withHealthStatus,
  type PositionMarkerDto,
} from './positions'
import {
  adminWorker,
  condition,
  metric,
  neverReported,
  reporting,
} from '@/test-utils/telemetryFixtures'

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
  // A posição chega sozinha do heartbeat; quem sabe a saúde é a telemetria.
  // Sem ela o pino é neutro, nunca verde por padrão.
  // A hora em que o celular registrou a posição acompanha o pino: é dela que
  // sai o "última posição às" do mapa e do detalhe.
  it('mapeia o dto do backend com a hora da posição e nasce neutro até a telemetria dizer o estado', () => {
    expect(toDashboardMarker(dto())).toEqual({
      id: 'w1',
      name: 'João Silva',
      lat: -23.5505,
      lng: -46.6333,
      status: 'offline',
      avatarUri: 'http://minio/presigned/w1.jpg',
      recordedAt: '2026-07-25T12:00:00.000Z',
    })
  })
})

describe('markerStatusFor', () => {
  it('sem entrada na lista ou sem leitura do aparelho é neutro', () => {
    expect(markerStatusFor(undefined)).toBe('offline')
    expect(markerStatusFor(adminWorker('w1', 'Ana', { telemetry: neverReported('w1') }))).toBe(
      'offline',
    )
  })

  it('leitura atual sem condição é bom', () => {
    expect(markerStatusFor(adminWorker('w1', 'Ana'))).toBe('good')
  })

  it('condição urgente aberta é urgência médica', () => {
    const entry = adminWorker('w1', 'Ana', {
      telemetry: {
        ...reporting({}, 'REAL', 'w1'),
        conditions: [condition('HEALTH'), condition('URGENT')],
      },
    })
    expect(markerStatusFor(entry)).toBe('low')
  })

  it('condição de saúde sem urgência é risco', () => {
    const entry = adminWorker('w1', 'Ana', {
      telemetry: { ...reporting({}, 'REAL', 'w1'), conditions: [condition('HEALTH')] },
    })
    expect(markerStatusFor(entry)).toBe('alert')
  })

  // Relógio descarregado não é funcionário em risco.
  it('condição só de aparelho não muda o estado de saúde', () => {
    const entry = adminWorker('w1', 'Ana', {
      telemetry: { ...reporting({}, 'REAL', 'w1'), conditions: [condition('DEVICE')] },
    })
    expect(markerStatusFor(entry)).toBe('good')
  })

  // Sem leitura atual ninguém confirma que a pessoa está bem.
  it('leitura velha sem condição é neutro', () => {
    const entry = adminWorker('w1', 'Ana', {
      telemetry: reporting(
        { heartRate: metric(98, { quality: 'STALE', measuredAt: '2026-10-01T14:20:00.000Z' }) },
        'REAL',
        'w1',
      ),
    })
    expect(markerStatusFor(entry)).toBe('offline')
  })
})

describe('withHealthStatus', () => {
  it('aplica a cada pino o estado do funcionário e mantém a posição intocada', () => {
    const markers = [toDashboardMarker(dto()), toDashboardMarker(dto({ id: 'w2', lat: -23.6 }))]
    const urgent = adminWorker('w2', 'Bia', {
      telemetry: { ...reporting({}, 'REAL', 'w2'), conditions: [condition('URGENT')] },
    })
    const result = withHealthStatus(markers, {
      observedAt: '2026-10-01T15:00:00.000Z',
      workers: [adminWorker('w1', 'João'), urgent],
    })
    expect(result.map((m) => m.status)).toEqual(['good', 'low'])
    expect(result[1]).toMatchObject({ lat: -23.6, lng: -46.6333 })
  })

  // A idade da posição é informação neutra: posição de ontem com leitura atual
  // segue com a cor do estado de saúde (decisão D2).
  it('posição velha não muda a cor do pino', () => {
    const old = toDashboardMarker(dto({ recordedAt: '2020-01-01T00:00:00.000Z' }))
    const telemetry = {
      observedAt: '2026-10-01T15:00:00.000Z',
      workers: [adminWorker('w1', 'João Silva')],
    }
    expect(withHealthStatus([old], telemetry)[0]?.status).toBe('good')
  })

  it('sem a lista da telemetria todos ficam neutros', () => {
    const result = withHealthStatus([toDashboardMarker(dto())], null)
    expect(result[0]?.status).toBe('offline')
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
    expect(res.data?.[0]).toMatchObject({ id: 'w1', status: 'offline' })
    expect(res.data?.[1]).toMatchObject({ id: 'w2', avatarUri: '' })
  })

  it('falha de rede degrada pra envelope de erro (sem lançar)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))

    const res = await positionsApi.list()

    expect(res.data).toBeNull()
    expect(res.error?.message).toBeTruthy()
  })
})
