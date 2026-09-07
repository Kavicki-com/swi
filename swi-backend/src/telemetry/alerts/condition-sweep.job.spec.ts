import { Logger } from '@nestjs/common'
import type { TelemetryConditionService } from './condition.service'
import { conditionSweepCron, DEFAULT_SWEEP_CRON, TelemetryConditionSweepJob } from './condition-sweep.job'

// O job é a camada mais fina da varredura: ele não decide nada. Quem sabe o que
// é silêncio, o que recupera e o que abre é o serviço, que a suíte chama direto
// com instante fixo. O que estes casos protegem é justamente isso: a expressão
// vem do ambiente, o handler delega passando o instante, e falha nenhuma escapa.

const jobWith = (sweep: jest.Mock) =>
  new TelemetryConditionSweepJob({ sweepSilentSessions: sweep } as unknown as TelemetryConditionService)

const nada = () => jest.fn().mockResolvedValue({ scanned: 0, signalLost: 0, recovered: 0 })

describe('conditionSweepCron: a expressão vem do ambiente', () => {
  it('o padrão é a cada 30 s', () => {
    // Perda de sinal abre com 120 s de silêncio, então varrer a cada 30 s deixa
    // a latência máxima de detecção em 150 s. O job do ciclo de vida não serve:
    // ele roda uma vez por dia, às 06:30.
    expect(DEFAULT_SWEEP_CRON).toBe('*/30 * * * * *')
    expect(conditionSweepCron({})).toBe(DEFAULT_SWEEP_CRON)
  })

  it('usa a expressão da variável quando ela existe', () => {
    expect(conditionSweepCron({ TELEMETRY_CONDITION_SWEEP_CRON: '*/10 * * * * *' })).toBe('*/10 * * * * *')
  })

  it('variável vazia é ausência, e não uma expressão vazia', () => {
    // Sem isto, uma variável declarada e apagada no ambiente derrubaria o
    // agendamento na subida, em vez de voltar ao padrão.
    expect(conditionSweepCron({ TELEMETRY_CONDITION_SWEEP_CRON: '' })).toBe(DEFAULT_SWEEP_CRON)
  })
})

describe('TelemetryConditionSweepJob.run: só delega', () => {
  it('chama o serviço passando o instante da rodada', async () => {
    const sweep = nada()
    const antes = Date.now()

    await jobWith(sweep).run()

    expect(sweep).toHaveBeenCalledTimes(1)
    const instante = sweep.mock.calls[0][0] as Date
    expect(instante).toBeInstanceOf(Date)
    expect(instante.getTime()).toBeGreaterThanOrEqual(antes)
    expect(instante.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('registra a rodada que mexeu no banco', async () => {
    // A rodada não tem requisição nem resposta: o log é o único lugar onde ela
    // aparece. Uma execução que abre condição em silêncio ninguém audita.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const sweep = jest.fn().mockResolvedValue({ scanned: 7, signalLost: 2, recovered: 3 })

    await jobWith(sweep).run()

    const linha = log.mock.calls[0][0] as string
    expect(linha).toMatch(/7 sess/)
    expect(linha).toMatch(/2 perda/)
    expect(linha).toMatch(/3 condi/)
    log.mockRestore()
  })

  it('rodada sem trabalho nenhum não vira linha de log', async () => {
    // A cada 30 s, e quase sempre sem ninguém calado: registrar toda rodada
    // encheria o log de nada e esconderia as que importam.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    await jobWith(jest.fn().mockResolvedValue({ scanned: 4, signalLost: 0, recovered: 0 })).run()

    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('falha na varredura vira aviso, e não derruba o processo', async () => {
    // Melhor esforço, como o ciclo de vida: o job roda sem ninguém olhando, e
    // uma exceção solta aqui vira rejeição não tratada no processo inteiro. O
    // que ficou de fora entra na rodada de daqui a 30 s.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const sweep = jest.fn().mockRejectedValue(new Error('banco fora do ar'))

    await expect(jobWith(sweep).run()).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('TelemetryConditionSweepJob.run: uma rodada por vez', () => {
  it('tique que cai com a rodada anterior em voo é pulado', async () => {
    // O agendador do Nest não pula tique por causa da rodada anterior: o
    // método devolve promessa que ninguém aguarda. Duas varreduras em voo ao
    // mesmo tempo não corrompem nada, mas dobram a carga justo quando o banco
    // já está sofrendo, que é o motivo de a rodada estar demorando.
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
    let libera = () => undefined as void
    const sweep = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          libera = () => resolve({ scanned: 0, signalLost: 0, recovered: 0 })
        }),
    )
    const job = jobWith(sweep)

    const emVoo = job.run()
    await job.run()

    expect(sweep).toHaveBeenCalledTimes(1)
    expect(debug).toHaveBeenCalledTimes(1)

    libera()
    await emVoo
    debug.mockRestore()
  })

  it('rodada que falhou não tranca as seguintes', async () => {
    // A guarda tem de cair no fim, e não no caminho feliz: uma exceção que
    // deixasse a marca em pé pararia a varredura para sempre, em silêncio.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const sweep = jest
      .fn()
      .mockRejectedValueOnce(new Error('banco fora do ar'))
      .mockResolvedValue({ scanned: 0, signalLost: 0, recovered: 0 })
    const job = jobWith(sweep)

    await job.run()
    await job.run()

    expect(sweep).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
