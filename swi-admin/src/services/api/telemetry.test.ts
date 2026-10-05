// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { apiFetch } from './http'
import { telemetryApi } from './telemetry'
import { onAlertTriaged } from '@/services/alerts/alertTriage'

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

describe('telemetryApi: leituras do painel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('adminSummary lê o resumo da empresa', async () => {
    fetchMock.mockResolvedValue({ observedAt: 'x' })
    const { data, error } = await telemetryApi.adminSummary()
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/summary')
    expect(data).toEqual({ observedAt: 'x' })
    expect(error).toBeNull()
  })

  it('adminWorkers lê todos os funcionários numa chamada', async () => {
    fetchMock.mockResolvedValue({ observedAt: 'x', workers: [] })
    const { data } = await telemetryApi.adminWorkers()
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/workers')
    expect(data).toEqual({ observedAt: 'x', workers: [] })
  })

  it('workerSeries pede o período do funcionário', async () => {
    fetchMock.mockResolvedValue({ points: [] })
    await telemetryApi.workerSeries('w 1', 'week')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/workers/w%201/series?period=week')
  })

  it('falha em qualquer leitura vira erro com mensagem', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('Sem permissão')
    })
    for (const call of [
      () => telemetryApi.adminSummary(),
      () => telemetryApi.adminWorkers(),
      () => telemetryApi.workerSeries('w1', 'day'),
      () => telemetryApi.alerts(),
    ]) {
      const { data, error } = await call()
      expect(data).toBeNull()
      expect(error).toEqual({ message: 'Sem permissão' })
    }
  })
})

describe('telemetryApi: fila de alertas', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('sem filtro pede a fila padrão do backend', async () => {
    fetchMock.mockResolvedValue({ items: [], nextCursor: null })
    const { data } = await telemetryApi.alerts()
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/alerts')
    expect(data).toEqual({ items: [], nextCursor: null })
  })

  it('status, limite e cursor viram query string', async () => {
    fetchMock.mockResolvedValue({ items: [], nextCursor: null })
    await telemetryApi.alerts({ status: ['OPEN', 'ACKNOWLEDGED'], limit: 20, cursor: 'c 1' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/admin/alerts?status=OPEN%2CACKNOWLEDGED&limit=20&cursor=c+1',
    )
  })

  it('reconhecer é POST sem corpo', async () => {
    fetchMock.mockResolvedValue({ id: 'a1', status: 'ACKNOWLEDGED' })
    const { data } = await telemetryApi.acknowledgeAlert('a 1')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/alerts/a%201/acknowledge', {
      method: 'POST',
    })
    expect(data).toEqual({ id: 'a1', status: 'ACKNOWLEDGED' })
  })

  it('resolver manda a observação quando há', async () => {
    fetchMock.mockResolvedValue({ id: 'a1', status: 'RESOLVED' })
    await telemetryApi.resolveAlert('a1', 'Pausa feita')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/alerts/a1/resolve', {
      method: 'POST',
      body: JSON.stringify({ note: 'Pausa feita' }),
    })
  })

  it('resolver sem observação manda corpo vazio', async () => {
    fetchMock.mockResolvedValue({ id: 'a1', status: 'RESOLVED' })
    await telemetryApi.resolveAlert('a1')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/admin/alerts/a1/resolve', {
      method: 'POST',
      body: JSON.stringify({}),
    })
  })

  // O aviso de alerta urgente relê a fila quando alguém triou aqui, sem
  // esperar a próxima releitura dele.
  it('reconhecer ou resolver com sucesso avisa quem acompanha a triagem', async () => {
    const heard = vi.fn()
    const stop = onAlertTriaged(heard)
    fetchMock.mockResolvedValue({ id: 'a1', status: 'ACKNOWLEDGED' })
    await telemetryApi.acknowledgeAlert('a1')
    fetchMock.mockResolvedValue({ id: 'a1', status: 'RESOLVED' })
    await telemetryApi.resolveAlert('a1')
    expect(heard).toHaveBeenCalledTimes(2)
    stop()
    await telemetryApi.acknowledgeAlert('a1')
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('falha de triagem não avisa', async () => {
    const heard = vi.fn()
    const stop = onAlertTriaged(heard)
    fetchMock.mockImplementation(async () => {
      throw new Error('Alerta já resolvido')
    })
    await telemetryApi.acknowledgeAlert('a1')
    await telemetryApi.resolveAlert('a1')
    expect(heard).not.toHaveBeenCalled()
    stop()
  })

  it('falha de triagem chega com a mensagem do backend', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('Alerta já resolvido')
    })
    const { data, error } = await telemetryApi.acknowledgeAlert('a1')
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'Alerta já resolvido' })
  })
})
