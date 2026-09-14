// O contrato entre o painel e as rotas de pareamento do backend: caminho,
// método, corpo e o envelope de erro. describe/it/expect/afterEach vêm dos
// globals do Vitest; importar os hooks de 'vitest' duplica a instância.
import { vi } from 'vitest'
import { telemetryDevicesApi } from './telemetryDevices'

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue({ ok: true, status, json: async () => body } as Response)

const fails = (status: number, message: string) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ message }) } as Response)

describe('telemetryDevicesApi.stateOf', () => {
  it('GET /telemetry/v1/devices/workers/:id devolve o estado como veio', async () => {
    const state = {
      device: { id: 'd1', kind: 'IPHONE', model: 'iPhone 15', pairedAt: '2026-09-14T12:00:00.000Z', lastSeenAt: null },
      pendingEnrollment: null,
    }
    const f = ok(state)
    vi.stubGlobal('fetch', f)

    const { data, error } = await telemetryDevicesApi.stateOf('w1')

    expect(error).toBeNull()
    expect(data).toEqual(state)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/telemetry/v1/devices/workers/w1')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('funcionário de outra empresa (404) vira envelope de erro com a mensagem do backend', async () => {
    vi.stubGlobal('fetch', fails(404, 'Funcionário não encontrado'))

    const { data, error } = await telemetryDevicesApi.stateOf('ghost')

    expect(data).toBeNull()
    expect(error?.message).toBe('Funcionário não encontrado')
  })
})

describe('telemetryDevicesApi.createEnrollment', () => {
  it('POST /telemetry/v1/devices/enrollments com o funcionário e o tipo iPhone', async () => {
    const f = ok({ enrollmentId: 'e1', code: '123456', expiresAt: '2026-09-14T12:10:00.000Z' }, 201)
    vi.stubGlobal('fetch', f)

    const { data, error } = await telemetryDevicesApi.createEnrollment('w1')

    expect(error).toBeNull()
    expect(data?.code).toBe('123456')
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/telemetry/v1/devices/enrollments')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ workerId: 'w1', kind: 'IPHONE' })
  })

  it('teto de taxa (429) vira envelope de erro, não exceção', async () => {
    vi.stubGlobal('fetch', fails(429, 'ThrottlerException: Too Many Requests'))

    const { data, error } = await telemetryDevicesApi.createEnrollment('w1')

    expect(data).toBeNull()
    expect(error?.message).toBeTruthy()
  })
})

describe('telemetryDevicesApi.revoke', () => {
  it('POST /telemetry/v1/devices/:id/revoke, 204 sem corpo', async () => {
    const f = ok({}, 204)
    vi.stubGlobal('fetch', f)

    const { error } = await telemetryDevicesApi.revoke('d1')

    expect(error).toBeNull()
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/telemetry/v1/devices/d1/revoke')
    expect(init.method).toBe('POST')
  })

  it('aparelho de outra empresa (404) vira envelope de erro', async () => {
    vi.stubGlobal('fetch', fails(404, 'Dispositivo não encontrado'))

    const { error } = await telemetryDevicesApi.revoke('alheio')

    expect(error?.message).toBe('Dispositivo não encontrado')
  })
})
