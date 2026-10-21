import { Logger } from '@nestjs/common'
import { CalibrationJob, calibrationCron, DEFAULT_CALIBRATION_CRON } from './calibration.job'
import type { CalibrationService } from './calibration.service'

const jobWith = (recalculateAll: jest.Mock) => new CalibrationJob({ recalculateAll } as unknown as CalibrationService)

describe('calibrationCron: a expressão vem do ambiente', () => {
  it('usa a expressão da variável quando ela existe', () => {
    expect(calibrationCron({ TELEMETRY_CALIBRATION_CRON: '0 0 7 * * *' })).toBe('0 0 7 * * *')
  })

  it('sem variável, ou com ela vazia, roda 15 minutos depois do ciclo de vida', () => {
    expect(calibrationCron({})).toBe(DEFAULT_CALIBRATION_CRON)
    expect(calibrationCron({ TELEMETRY_CALIBRATION_CRON: '' })).toBe(DEFAULT_CALIBRATION_CRON)
  })
})

describe('CalibrationJob.run: só delega', () => {
  it('chama o serviço passando o instante da rodada', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const recalculateAll = jest.fn().mockResolvedValue({ recalculated: 3, failed: 0 })
    const antes = Date.now()

    await jobWith(recalculateAll).run()

    expect(recalculateAll).toHaveBeenCalledTimes(1)
    const instante = recalculateAll.mock.calls[0][0] as Date
    expect(instante.getTime()).toBeGreaterThanOrEqual(antes)
    expect(instante.getTime()).toBeLessThanOrEqual(Date.now())
    expect(log).toHaveBeenCalledWith(expect.stringContaining('3 funcionários recalculados'))
    log.mockRestore()
  })

  it('falha vira aviso, nunca rejeição solta', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(jobWith(jest.fn().mockRejectedValue(new Error('banco fora'))).run()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('banco fora'))
    warn.mockRestore()
  })
})
