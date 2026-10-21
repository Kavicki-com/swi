// describe/it/expect/beforeEach vêm dos globals do Vitest.
import { vi } from 'vitest'
import { apiFetch } from './http'
import { calibrationApi, type CalibrationDetail } from './calibration'

vi.mock('./http', () => ({ apiFetch: vi.fn() }))

const fetchMock = vi.mocked(apiFetch)

const DETAIL: CalibrationDetail = {
  workerId: 'w 1',
  version: 'swi-calibration-1',
  phase: 'CALIBRATING',
  day: 12,
  recalibrating: false,
  deviceFamily: 'WATCH',
  ruler: {
    restingBpm: 62,
    peakBpm: 171,
    peakPersonalBpm: 168,
    peakStartBpm: 182,
    maxBpmByAge: 182,
  },
  metrics: [
    {
      metric: 'HEART_RATE',
      validDays: 12,
      start: { excellence: 120, fatigue: 150 },
      learned: { excellence: 118, fatigue: 146 },
      override: null,
      effective: { excellence: 118, fatigue: 146 },
      source: 'LEARNED',
    },
  ],
  safety: [
    {
      rule: 'OXYGEN_LOW',
      defaultLabel: 'Oxigenação abaixo de 90%',
      defaultValues: { openAt: 90, closeAt: 92 },
      effective: { openAt: 90, closeAt: 92 },
      custom: false,
      updatedAt: null,
    },
  ],
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('calibrationApi: leituras', () => {
  it('detail lê a calibração do funcionário pela rota dele', async () => {
    fetchMock.mockResolvedValue(DETAIL)
    const { data, error } = await calibrationApi.detail('w 1')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/workers/w%201/calibration')
    expect(data).toEqual(DETAIL)
    expect(error).toBeNull()
  })

  it('history sem cursor lê a primeira página', async () => {
    fetchMock.mockResolvedValue({ items: [], nextCursor: null })
    const { data } = await calibrationApi.history('w 1')
    expect(fetchMock).toHaveBeenCalledWith('/telemetry/v1/workers/w%201/calibration/history')
    expect(data).toEqual({ items: [], nextCursor: null })
  })

  it('history com cursor pede a página seguinte, cursor escapado', async () => {
    fetchMock.mockResolvedValue({ items: [], nextCursor: null })
    await calibrationApi.history('w1', 'c/2')
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/workers/w1/calibration/history?cursor=c%2F2',
    )
  })

  it('falha vira erro com mensagem, nunca leitura vazia', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('Funcionário não encontrado')
    })
    const { data, error } = await calibrationApi.detail('w1')
    expect(data).toBeNull()
    expect(error).toEqual({ message: 'Funcionário não encontrado' })
  })

  it('falha sem mensagem usa o texto padrão', async () => {
    fetchMock.mockImplementation(async () => {
      throw 'sem objeto de erro'
    })
    const { error } = await calibrationApi.history('w1')
    expect(error).toEqual({ message: 'Falha ao carregar o histórico da calibração' })
  })
})

describe('calibrationApi: correções', () => {
  it('setBand grava os cortes com PUT e devolve o detalhe atualizado', async () => {
    fetchMock.mockResolvedValue(DETAIL)
    const { data } = await calibrationApi.setBand('w 1', 'HEART_RATE', {
      excellence: 115,
      fatigue: 140,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/workers/w%201/calibration/bands/HEART_RATE',
      {
        method: 'PUT',
        body: JSON.stringify({ cuts: { excellence: 115, fatigue: 140 } }),
      },
    )
    expect(data).toEqual(DETAIL)
  })

  it('revertBand remove a correção com DELETE', async () => {
    fetchMock.mockResolvedValue(DETAIL)
    await calibrationApi.revertBand('w 1', 'BODY_TEMPERATURE')
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/workers/w%201/calibration/bands/BODY_TEMPERATURE',
      { method: 'DELETE' },
    )
  })

  it('setSafety grava os valores da trava com PUT', async () => {
    fetchMock.mockResolvedValue(DETAIL)
    const values = {
      systolicAt: 180,
      diastolicAt: 110,
      systolicRecoverBelow: 170,
      diastolicRecoverBelow: 100,
    }
    await calibrationApi.setSafety('w 1', 'BLOOD_PRESSURE_HIGH', values)
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/workers/w%201/calibration/safety/BLOOD_PRESSURE_HIGH',
      { method: 'PUT', body: JSON.stringify({ values }) },
    )
  })

  it('revertSafety remove a trava personalizada com DELETE', async () => {
    fetchMock.mockResolvedValue(DETAIL)
    await calibrationApi.revertSafety('w 1', 'WEAR_HIGH')
    expect(fetchMock).toHaveBeenCalledWith(
      '/telemetry/v1/workers/w%201/calibration/safety/WEAR_HIGH',
      {
        method: 'DELETE',
      },
    )
  })

  it('recusa do servidor chega como erro com a mensagem dele', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('A abertura da trava de batimento alto deve ficar entre 100 e 230.')
    })
    const { data, error } = await calibrationApi.setSafety('w1', 'HEART_RATE_HIGH', {
      openAt: 90,
      closeAt: 85,
    })
    expect(data).toBeNull()
    expect(error).toEqual({
      message: 'A abertura da trava de batimento alto deve ficar entre 100 e 230.',
    })
  })
})
