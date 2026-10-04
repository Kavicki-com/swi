import { Logger } from '@nestjs/common'
import { IDEMPOTENCY_KEY_RETENTION_MS, IdempotencyRetentionJob, purgeExpiredKeys } from './idempotency-retention.job'

const NOW = new Date('2026-10-04T07:00:00Z')

describe('purgeExpiredKeys', () => {
  // 30 dias cobrem com folga um aparelho que passou semanas sem sinal e ainda
  // tem a fila cheia: até lá, o reenvio ainda acha a chave.
  it('apaga as chaves com mais de 30 dias e devolve quantas', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 4 })
    const deleted = await purgeExpiredKeys({ idempotencyKey: { deleteMany } } as never, NOW)
    expect(deleted).toBe(4)
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) } },
    })
    expect(IDEMPOTENCY_KEY_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})

describe('IdempotencyRetentionJob.run', () => {
  afterEach(() => jest.restoreAllMocks())

  it('apaga e registra a contagem no log', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 })
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    await new IdempotencyRetentionJob({ idempotencyKey: { deleteMany } } as never).run()
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2'))
  })

  // O job roda sem ninguém olhando: uma exceção solta viraria rejeição não
  // tratada no processo.
  it('falha vira aviso no log, nunca exceção', async () => {
    const deleteMany = jest.fn().mockRejectedValue(new Error('db down'))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    await expect(new IdempotencyRetentionJob({ idempotencyKey: { deleteMany } } as never).run()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})
