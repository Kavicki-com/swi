import { Logger } from '@nestjs/common'
import {
  DEFAULT_POSITION_RETENTION_CRON,
  PositionRetentionJob,
  positionRetentionCron,
} from './position-retention.job'
import type { PositionHistoryService } from './position-history.service'

// O job só agenda e delega; a regra de apagar mora no serviço.

describe('positionRetentionCron', () => {
  it('usa a expressão da variável, e sem ela cai na madrugada', () => {
    expect(positionRetentionCron({ POSITION_RETENTION_CRON: '0 0 5 * * *' })).toBe('0 0 5 * * *')
    expect(positionRetentionCron({})).toBe(DEFAULT_POSITION_RETENTION_CRON)
    expect(positionRetentionCron({ POSITION_RETENTION_CRON: '' })).toBe(DEFAULT_POSITION_RETENTION_CRON)
  })
})

describe('PositionRetentionJob.run', () => {
  afterEach(() => jest.restoreAllMocks())

  it('apaga com a janela do ambiente', async () => {
    const purge = jest.fn().mockResolvedValue({ deleted: 3, stoppedByBudget: false })
    const job = new PositionRetentionJob({ purge } as unknown as PositionHistoryService)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const previous = process.env.POSITION_RETENTION_DAYS
    process.env.POSITION_RETENTION_DAYS = '7'
    try {
      await job.run()
    } finally {
      if (previous === undefined) delete process.env.POSITION_RETENTION_DAYS
      else process.env.POSITION_RETENTION_DAYS = previous
    }
    expect(purge).toHaveBeenCalledTimes(1)
    const [now, retention] = purge.mock.calls[0]
    expect(now).toBeInstanceOf(Date)
    expect(retention.windowMs).toBe(7 * 24 * 60 * 60 * 1000)
  })

  // O job roda sem ninguém olhando: uma exceção solta viraria rejeição não
  // tratada no processo.
  it('falha vira aviso no log, nunca exceção', async () => {
    const purge = jest.fn().mockRejectedValue(new Error('db down'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    await expect(
      new PositionRetentionJob({ purge } as unknown as PositionHistoryService).run(),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
