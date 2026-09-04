import { Logger } from '@nestjs/common'
import {
  DEFAULT_LIFECYCLE_CRON,
  lifecycleCron,
  TelemetryLifecycleJob,
} from './telemetry-lifecycle.job'
import type { TelemetryLifecycleService } from './telemetry-lifecycle.service'

// O job é a camada mais fina do ciclo de vida: ele não decide nada. Toda regra
// está no serviço, que a suíte chama direto com instante fixo. O que estes
// casos protegem é justamente isso: a expressão vem do ambiente e o handler
// delega, passando o instante.

const jobWith = (summarize: jest.Mock) =>
  new TelemetryLifecycleJob({
    summarizeClosedDays: summarize,
  } as unknown as TelemetryLifecycleService)

describe('lifecycleCron: a expressão vem do ambiente', () => {
  it('usa a expressão da variável quando ela existe', () => {
    expect(lifecycleCron({ TELEMETRY_LIFECYCLE_CRON: '0 0 4 * * *' })).toBe('0 0 4 * * *')
  })

  it('sem variável, cai no padrão diário de madrugada', () => {
    expect(lifecycleCron({})).toBe(DEFAULT_LIFECYCLE_CRON)
  })

  it('variável vazia é ausência, e não uma expressão vazia', () => {
    // Sem isto, uma variável declarada e apagada no ambiente derrubaria o
    // agendamento na subida, em vez de voltar ao padrão.
    expect(lifecycleCron({ TELEMETRY_LIFECYCLE_CRON: '' })).toBe(DEFAULT_LIFECYCLE_CRON)
  })
})

describe('TelemetryLifecycleJob.run: só delega', () => {
  it('chama o serviço passando o instante da rodada', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const summarize = jest.fn().mockResolvedValue({ summarized: 2, failed: 0 })
    const antes = Date.now()

    await jobWith(summarize).run()
    log.mockRestore()

    expect(summarize).toHaveBeenCalledTimes(1)
    const instante = summarize.mock.calls[0][0] as Date
    expect(instante).toBeInstanceOf(Date)
    expect(instante.getTime()).toBeGreaterThanOrEqual(antes)
    expect(instante.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('registra o resultado da rodada', async () => {
    // A rodada não tem requisição nem resposta: o log é o único lugar onde ela
    // aparece. Uma execução que muda o banco em silêncio ninguém audita.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const summarize = jest.fn().mockResolvedValue({ summarized: 3, failed: 1 })

    await jobWith(summarize).run()

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/3 dias resumidos/))
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/1 falharam/))
    log.mockRestore()
  })

  it('falha na varredura vira aviso, e não derruba o processo', async () => {
    // Melhor esforço, como o alerta de clima: o job roda sem ninguém olhando, e
    // uma exceção solta aqui vira rejeição não tratada no processo inteiro.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const summarize = jest.fn().mockRejectedValue(new Error('banco fora do ar'))

    await expect(jobWith(summarize).run()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
