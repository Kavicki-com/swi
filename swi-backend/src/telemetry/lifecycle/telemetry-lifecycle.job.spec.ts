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

const EMPTY_PURGE = {
  daysPurged: 0,
  samplesDeleted: 0,
  assessmentsDeleted: 0,
  stoppedByBudget: false,
}

const jobWith = (
  summarize: jest.Mock,
  purge: jest.Mock = jest.fn().mockResolvedValue(EMPTY_PURGE),
) =>
  new TelemetryLifecycleJob({
    summarizeClosedDays: summarize,
    purgeRetainedData: purge,
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

  it('resume antes de apagar, sempre', async () => {
    // A ordem é a garantia central do ciclo de vida: apagar antes de resumir
    // destruiria a Leitura do dia que a mesma execução ainda ia resumir, e o
    // dado não volta. Por isso ela é afirmada, e não deixada ao acaso.
    const summarize = jest.fn().mockResolvedValue({ summarized: 1, failed: 0 })
    const purge = jest.fn().mockResolvedValue(EMPTY_PURGE)

    await jobWith(summarize, purge).run()

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(purge).toHaveBeenCalledTimes(1)
    expect(summarize.mock.invocationCallOrder[0]).toBeLessThan(purge.mock.invocationCallOrder[0])
  })

  it('as duas etapas recebem o mesmo instante da rodada', async () => {
    // Instantes diferentes fariam a retenção medir a janela contra um relógio
    // que a varredura não usou, e a fronteira do dia poderia cair entre as duas.
    const summarize = jest.fn().mockResolvedValue({ summarized: 0, failed: 0 })
    const purge = jest.fn().mockResolvedValue(EMPTY_PURGE)

    await jobWith(summarize, purge).run()

    expect(purge.mock.calls[0][0]).toEqual(summarize.mock.calls[0][0])
  })

  it('falha ao resumir não deixa a retenção apagar', async () => {
    // Se a varredura caiu, não se sabe o que foi resumido nesta noite. Apagar
    // assim mesmo é o único erro do ciclo de vida que não tem volta.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const summarize = jest.fn().mockRejectedValue(new Error('banco fora do ar'))
    const purge = jest.fn().mockResolvedValue(EMPTY_PURGE)

    await expect(jobWith(summarize, purge).run()).resolves.toBeUndefined()

    expect(purge).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('registra o resultado da rodada', async () => {
    // A rodada não tem requisição nem resposta: o log é o único lugar onde ela
    // aparece. Uma execução que muda o banco em silêncio ninguém audita.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const summarize = jest.fn().mockResolvedValue({ summarized: 3, failed: 1 })
    const purge = jest.fn().mockResolvedValue({
      daysPurged: 2,
      samplesDeleted: 40,
      assessmentsDeleted: 5,
      stoppedByBudget: true,
    })

    await jobWith(summarize, purge).run()

    const linha = log.mock.calls[0][0] as string
    expect(linha).toMatch(/3 dias resumidos/)
    expect(linha).toMatch(/1 falharam/)
    // Linhas apagadas por tabela, e não um total só: sem separar, ninguém sabe
    // se a avaliação está sendo retida junto com a Leitura.
    expect(linha).toMatch(/40 leituras/)
    expect(linha).toMatch(/5 avaliações/)
    expect(linha).toMatch(/orçamento/)
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
