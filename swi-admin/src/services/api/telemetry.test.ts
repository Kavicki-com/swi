// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { apiFetch } from './http'
import { telemetryApi } from './telemetry'

vi.mock('./http', () => ({ apiFetch: vi.fn() }))

const fetchMock = vi.mocked(apiFetch)

describe('telemetryApi.workerCurrent', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('lê o estado atual pela rota do funcionário', async () => {
    fetchMock.mockResolvedValue({ workerId: 'w 1' })
    const { data, error } = await telemetryApi.workerCurrent('w 1')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/workers/w%201/current')
    expect(data).toEqual({ workerId: 'w 1' })
    expect(error).toBeNull()
  })

  it('falha vira erro com mensagem, nunca leitura vazia', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('Funcionário não encontrado')
    })
    const { data, error } = await telemetryApi.workerCurrent('w1')
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'Funcionário não encontrado' })
  })
})
