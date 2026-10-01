// O contrato entre o painel e a rota do mapa de calor: caminho, janela e o
// envelope de erro. Troca o fetch global, como a suíte do pareamento, para
// exercitar o apiFetch de verdade. describe/it/expect/afterEach vêm dos globals.
import { vi } from 'vitest'
import { positionHeatApi } from './positionHeat'

afterEach(() => vi.unstubAllGlobals())

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response)

const fails = (status: number, message: string) =>
  vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ message }) } as Response)

describe('positionHeatApi.heat', () => {
  it('sem janela pede a janela padrão do backend e devolve as células como vieram', async () => {
    const body = {
      cellSizeM: 50,
      from: 'a',
      to: 'b',
      cells: [{ lat: -23.5, lng: -46.6, weight: 12 }],
    }
    const f = ok(body)
    vi.stubGlobal('fetch', f)

    const { data, error } = await positionHeatApi.heat()

    expect(error).toBeNull()
    expect(data).toEqual(body)
    const [url] = f.mock.calls[0] as [string]
    expect(url).toMatch(/\/positions\/heat$/)
  })

  it('janela vira query string em ISO-8601', async () => {
    const f = ok({ cellSizeM: 50, from: 'a', to: 'b', cells: [] })
    vi.stubGlobal('fetch', f)

    await positionHeatApi.heat({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T12:00:00.000Z' })

    const [url] = f.mock.calls[0] as [string]
    expect(url).toContain(
      '/positions/heat?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-01T12%3A00%3A00.000Z',
    )
  })

  it('janela inválida (400) vira envelope de erro, nunca mapa vazio', async () => {
    vi.stubGlobal('fetch', fails(400, 'Janela inválida'))

    const { data, error } = await positionHeatApi.heat({ from: 'x' })

    expect(data).toBeNull()
    expect(error?.message).toBe('Janela inválida')
  })
})
