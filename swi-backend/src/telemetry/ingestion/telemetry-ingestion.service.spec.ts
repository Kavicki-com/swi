import { randomUUID } from 'node:crypto'
import type { RealtimeGateway } from '../../realtime/realtime.gateway'
import type { TelemetryConditionService } from '../alerts/condition.service'
import type { TelemetryAssessmentService } from '../assessment/assessment.service'
import type { DeviceIdentity } from '../devices/device-auth.service'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
  type SaveEventResult,
} from '../persistence/telemetry.repository'
import type { TelemetryAudienceService } from '../realtime/telemetry-audience.service'
import type { TelemetryEventDto } from './dto/telemetry-batch.dto'
import { TelemetryIngestionService } from './telemetry-ingestion.service'

// O que estes casos protegem é a fronteira entre o que o aparelho afirma e o
// que o backend aceita como verdade. Persistência real é assunto do e2e; aqui a
// pergunta é de autoridade, de ordem e do que volta no ACK.

const DEVICE: DeviceIdentity = { deviceId: 'device-1', workerId: 'worker-1' }
const SESSION = randomUUID()

const stored = (over: Partial<SaveEventResult> = {}): SaveEventResult => ({
  outcome: 'STORED',
  sampleId: randomUUID(),
  snapshotPromoted: true,
  ...over,
})

const repositoryDouble = () => ({
  ensureSession: jest.fn().mockImplementation(async (input: { id: string; origin: string }) => ({
    id: input.id,
    deviceId: DEVICE.deviceId,
    workerId: DEVICE.workerId,
    origin: input.origin,
  })),
  saveEvent: jest.fn().mockResolvedValue(stored()),
})

const realtimeDouble = () => ({ emitToUsers: jest.fn() })

const assessmentDouble = () => ({
  assessSession: jest.fn().mockResolvedValue({ outcome: 'assessed', assessmentId: 'a-1' }),
})

const conditionsDouble = () => ({
  evaluateSession: jest.fn().mockResolvedValue({ opened: [], recovered: [], alerts: 0 }),
  evaluateSpotReading: jest.fn().mockResolvedValue({ opened: [], recovered: [], alerts: 0 }),
})

/** Por padrão só o próprio funcionário, como quem não tem empresa. */
const audienceDouble = () => ({
  recipientsFor: jest.fn().mockImplementation(async (workerId: string) => [workerId]),
})

const build = () => {
  const repository = repositoryDouble()
  const realtime = realtimeDouble()
  const assessment = assessmentDouble()
  const conditions = conditionsDouble()
  const audience = audienceDouble()
  const service = new TelemetryIngestionService(
    repository,
    realtime as unknown as RealtimeGateway,
    assessment as unknown as TelemetryAssessmentService,
    conditions as unknown as TelemetryConditionService,
    audience as unknown as TelemetryAudienceService,
  )
  return { repository, realtime, assessment, conditions, audience, service }
}

// eventTime recente de propósito: um horário antigo cairia na regra de backlog
// e mudaria o que cada caso está medindo.
const event = (over: Partial<TelemetryEventDto> = {}): TelemetryEventDto =>
  ({
    eventId: randomUUID(),
    monitoringSessionId: SESSION,
    sequence: 1,
    eventTime: new Date(Date.now() - 5_000).toISOString(),
    origin: 'REAL',
    measurements: { heartRate: { value: 82, unit: 'bpm', source: 'APPLE_WATCH' } },
    ...over,
  })

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('TelemetryIngestionService', () => {
  it('confirma cada evento pelo próprio eventId', async () => {
    const { service } = build()
    const um = event()
    const dois = event({ sequence: 2 })

    const ack = await service.ingest(DEVICE, { events: [um, dois] })

    expect(ack.acceptedEventIds).toEqual([um.eventId, dois.eventId])
    expect(ack.duplicateEventIds).toEqual([])
    expect(ack.conflicts).toEqual([])
    expect(Date.parse(ack.serverTime)).not.toBeNaN()
  })

  // "Sem aguardar fechamento de lote ou janela": um evento entra sozinho e é
  // gravado na hora. Se a ingestão acumulasse para gravar depois, o caminho
  // conectado chegaria ao painel com o atraso da janela.
  it('grava o evento conectado imediatamente, um por um', async () => {
    const { service, repository } = build()

    await service.ingest(DEVICE, { events: [event()] })

    expect(repository.saveEvent).toHaveBeenCalledTimes(1)
  })

  it('deriva funcionário e aparelho da credencial, nunca do corpo', async () => {
    const { service, repository } = build()

    await service.ingest(DEVICE, { events: [event()] })

    const [persisted] = repository.saveEvent.mock.calls[0]
    expect(persisted.deviceId).toBe(DEVICE.deviceId)
    expect(persisted).not.toHaveProperty('workerId')
  })

  it('carimba receivedAt no servidor, sem aceitar o do aparelho', async () => {
    const { service, repository } = build()
    const forjado = new Date('2020-01-01T00:00:00.000Z').toISOString()

    await service.ingest(DEVICE, { events: [event({ receivedAt: forjado } as never)] })

    const [persisted] = repository.saveEvent.mock.calls[0]
    expect(persisted.receivedAt).not.toBe(forjado)
    expect(Date.parse(persisted.receivedAt)).toBeGreaterThan(Date.parse(forjado))
  })

  it('repete o ACK sem gravar de novo quando o evento já estava salvo', async () => {
    const { service, repository } = build()
    repository.saveEvent.mockResolvedValue(stored({ outcome: 'DUPLICATE', snapshotPromoted: false }))
    const repetido = event()

    const ack = await service.ingest(DEVICE, { events: [repetido] })

    expect(ack.duplicateEventIds).toEqual([repetido.eventId])
    expect(ack.acceptedEventIds).toEqual([])
  })

  it('devolve o conflito de integridade com motivo próprio, sem derrubar o lote', async () => {
    const { service, repository } = build()
    const conflitante = event()
    repository.saveEvent.mockRejectedValueOnce(
      new TelemetryIntegrityConflictError('eventId', conflitante.eventId, 'conteúdo diferente'),
    )

    const ack = await service.ingest(DEVICE, { events: [conflitante] })

    expect(ack.conflicts).toEqual([
      { eventId: conflitante.eventId, reason: 'event_id_conflict', detail: expect.any(String) },
    ])
  })

  it('separa aceitos, repetidos e rejeitados num lote parcial', async () => {
    const { service, repository } = build()
    const aceito = event({ sequence: 1 })
    const repetido = event({ sequence: 2 })
    const rejeitado = event({
      sequence: 3,
      measurements: { heartRate: { value: 999, unit: 'bpm', source: 'APPLE_WATCH' } },
    })
    repository.saveEvent
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(stored({ outcome: 'DUPLICATE', snapshotPromoted: false }))

    const ack = await service.ingest(DEVICE, { events: [aceito, repetido, rejeitado] })

    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
    expect(ack.duplicateEventIds).toEqual([repetido.eventId])
    expect(ack.conflicts.map((c) => c.eventId)).toEqual([rejeitado.eventId])
    // O impossível nem chega ao banco: gravar para rejeitar depois deixaria no
    // histórico um número que nenhuma tela pode mostrar.
    expect(repository.saveEvent).toHaveBeenCalledTimes(2)
  })

  describe('recusa de medição', () => {
    const rejeita = async (over: Partial<TelemetryEventDto>, reason: string) => {
      const { service, repository } = build()
      const ruim = event(over)

      const ack = await service.ingest(DEVICE, { events: [ruim] })

      expect(ack.conflicts).toEqual([{ eventId: ruim.eventId, reason, detail: expect.any(String) }])
      expect(repository.saveEvent).not.toHaveBeenCalled()
    }

    it('recusa o evento que tenta impor workerId', () =>
      rejeita({ workerId: 'outro-funcionario' } as never, 'invalid_event'))

    it('recusa valor impossível', () =>
      rejeita(
        { measurements: { heartRate: { value: 999, unit: 'bpm', source: 'APPLE_WATCH' } } },
        'invalid_measurement',
      ))

    it('recusa NaN', () =>
      rejeita(
        { measurements: { heartRate: { value: Number.NaN, unit: 'bpm', source: 'APPLE_WATCH' } } },
        'invalid_measurement',
      ))

    it('recusa unidade errada', () =>
      rejeita(
        { measurements: { heartRate: { value: 82, unit: 'bpm/min', source: 'APPLE_WATCH' } } },
        'invalid_measurement',
      ))

    it('recusa medição desconhecida em vez de descartá-la em silêncio', () =>
      rejeita(
        { measurements: { humidity: { value: 1, unit: '%', source: 'APPLE_WATCH' } } },
        'invalid_event',
      ))

    it('recusa horário de medição no futuro', () =>
      rejeita({ eventTime: new Date(Date.now() + 10 * 60_000).toISOString() }, 'invalid_event'))

    it('recusa pressão sem o par sistólica/diastólica', () =>
      rejeita(
        {
          measurements: {
            bloodPressure: { value: { systolic: 120 }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
          },
        },
        'invalid_measurement',
      ))

    it('recusa pressão vinda do relógio', () =>
      rejeita(
        {
          measurements: {
            bloodPressure: {
              value: { systolic: 120, diastolic: 80 },
              unit: 'mmHg',
              source: 'APPLE_WATCH',
            },
          },
        },
        'invalid_measurement',
      ))

    it('aceita pressão de aparelho externo', async () => {
      const { service, repository } = build()

      const ack = await service.ingest(DEVICE, {
        events: [
          event({
            measurements: {
              bloodPressure: {
                value: { systolic: 120, diastolic: 80 },
                unit: 'mmHg',
                source: 'EXTERNAL_CUFF',
              },
            },
          }),
        ],
      })

      expect(ack.conflicts).toEqual([])
      expect(repository.saveEvent).toHaveBeenCalledTimes(1)
    })

    // A recusa não pode ecoar o número medido: a resposta de erro vai para log
    // de cliente e de servidor, e é assim que dado de saúde escapa sem ninguém
    // decidir por isso.
    it('não repete o valor medido no motivo da recusa', async () => {
      const { service } = build()
      // eventId fixo: um UUID sorteado pode conter "999" e faria a asserção
      // acusar o identificador em vez do valor medido.
      const eventId = '00000000-0000-4000-8000-000000000001'

      const ack = await service.ingest(DEVICE, {
        events: [
          event({
            eventId,
            measurements: { heartRate: { value: 999, unit: 'bpm', source: 'APPLE_WATCH' } },
          }),
        ],
      })

      expect(ack.conflicts[0].detail).not.toContain('999')
    })
  })

  it('recusa evento de sessão que pertence a outro aparelho', async () => {
    const { service, repository } = build()
    repository.ensureSession.mockResolvedValue({
      id: SESSION,
      deviceId: 'outro-aparelho',
      workerId: 'outro-funcionario',
      origin: 'REAL',
    })
    const intruso = event()

    const ack = await service.ingest(DEVICE, { events: [intruso] })

    expect(ack.conflicts).toEqual([
      { eventId: intruso.eventId, reason: 'session_unavailable', detail: expect.any(String) },
    ])
    expect(repository.saveEvent).not.toHaveBeenCalled()
  })

  it('traduz sessão inexistente em recusa do evento, não em erro do lote', async () => {
    const { service, repository } = build()
    repository.saveEvent.mockRejectedValueOnce(new TelemetrySessionNotFoundError(SESSION))
    const orfao = event()

    const ack = await service.ingest(DEVICE, { events: [orfao] })

    expect(ack.conflicts.map((c) => c.reason)).toEqual(['session_unavailable'])
  })

  it('abre a sessão nomeada pelo aparelho uma vez por lote', async () => {
    const { service, repository } = build()

    await service.ingest(DEVICE, { events: [event({ sequence: 1 }), event({ sequence: 2 })] })

    expect(repository.ensureSession).toHaveBeenCalledTimes(1)
    expect(repository.ensureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SESSION,
        deviceId: DEVICE.deviceId,
        workerId: DEVICE.workerId,
      }),
    )
  })

  it('só responde depois de a persistência confirmar', async () => {
    const { service, repository } = build()
    let liberar = () => {}
    repository.saveEvent.mockReturnValue(
      new Promise<SaveEventResult>((resolve) => {
        liberar = () => resolve(stored())
      }),
    )
    const respondeu = jest.fn()

    const emCurso = service.ingest(DEVICE, { events: [event()] }).then(respondeu)
    await flush()
    expect(respondeu).not.toHaveBeenCalled()

    liberar()
    await emCurso
    expect(respondeu).toHaveBeenCalled()
  })

  it('avisa pelo socket somente depois do commit', async () => {
    const { service, repository, realtime } = build()
    const ordem: string[] = []
    repository.saveEvent.mockImplementation(async () => {
      ordem.push('commit')
      return stored()
    })
    realtime.emitToUsers.mockImplementation(() => ordem.push('socket'))

    await service.ingest(DEVICE, { events: [event()] })

    expect(ordem).toEqual(['commit', 'socket'])
  })

  it('avisa uma vez por lote, não uma vez por evento', async () => {
    const { service, realtime } = build()

    await service.ingest(DEVICE, { events: [event({ sequence: 1 }), event({ sequence: 2 })] })

    expect(realtime.emitToUsers).toHaveBeenCalledTimes(1)
    const [destinatarios, nome] = realtime.emitToUsers.mock.calls[0]
    expect(destinatarios).toEqual([DEVICE.workerId])
    expect(nome).toBe('telemetry.snapshot.updated')
  })

  // O painel precisa saber sem recarregar: o aviso vai também aos
  // administradores da empresa do funcionário, e é o serviço de destinatários
  // quem decide quem são.
  it('avisa também os administradores da empresa do funcionário', async () => {
    const { service, realtime, audience } = build()
    audience.recipientsFor.mockResolvedValue([DEVICE.workerId, 'admin-1', 'admin-2'])

    await service.ingest(DEVICE, { events: [event()] })

    expect(audience.recipientsFor).toHaveBeenCalledWith(DEVICE.workerId)
    const [destinatarios, nome] = realtime.emitToUsers.mock.calls[0]
    expect(destinatarios).toEqual([DEVICE.workerId, 'admin-1', 'admin-2'])
    expect(nome).toBe('telemetry.snapshot.updated')
  })

  // O socket carrega o aviso de que há o que reconciliar, e o read model vem
  // pelo REST. Mandar o valor aqui criaria uma segunda fonte da verdade, e uma
  // que atravessa a rede sem passar pelo controle de acesso do read model.
  it('não manda valor de saúde pelo socket', async () => {
    const { service, realtime } = build()

    await service.ingest(DEVICE, {
      events: [
        event({ measurements: { heartRate: { value: 82, unit: 'bpm', source: 'APPLE_WATCH' } } }),
      ],
    })

    // Asserção pela forma, e não por substring: um UUID sorteado pode conter
    // "82" e o teste passaria a acusar o identificador em vez da medição.
    const payload = realtime.emitToUsers.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual([
      'eventId',
      'monitoringSessionId',
      'revision',
      'workerId',
    ])
  })

  it('não avisa quando nada foi promovido ao estado atual', async () => {
    const { service, repository, realtime } = build()
    repository.saveEvent.mockResolvedValue(stored({ snapshotPromoted: false }))

    await service.ingest(DEVICE, { events: [event()] })

    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  // Backlog de mais de 48 horas entra na trilha e não vira "o que está
  // acontecendo agora". Quem decide isso é o repositório; o que se prova aqui é
  // que a ingestão aceita o evento e não anuncia atualização.
  it('aceita evento antigo como histórico, sem efeito no estado atual', async () => {
    const { service, repository, realtime } = build()
    repository.saveEvent.mockResolvedValue(stored({ snapshotPromoted: false }))
    const antigo = event({ eventTime: new Date(Date.now() - 72 * 3_600_000).toISOString() })

    const ack = await service.ingest(DEVICE, { events: [antigo] })

    expect(ack.acceptedEventIds).toEqual([antigo.eventId])
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  // Uma falha de socket não pode desfazer o que já está no banco: o evento foi
  // aceito, e o cliente reconcilia pelo REST.
  it('mantém o ACK quando o aviso pelo socket falha', async () => {
    const { service, realtime } = build()
    realtime.emitToUsers.mockImplementation(() => {
      throw new Error('socket down')
    })
    const aceito = event()

    const ack = await service.ingest(DEVICE, { events: [aceito] })

    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
  })

  // A revisão é o que deixa o cliente descartar aviso mais velho do que o que
  // já aplicou, e por isso faz parte do contrato de realtime.
  it('anuncia a revisão do que foi promovido, para o cliente ordenar', async () => {
    const { service, realtime } = build()
    const promovido = event()

    await service.ingest(DEVICE, { events: [promovido] })

    const payload = realtime.emitToUsers.mock.calls[0][2] as { revision: string }
    expect(payload.revision).toBe(promovido.eventTime)
  })

  it('recusa evento que não mede nada', async () => {
    const { service, repository } = build()
    const vazio = event({ measurements: {} })

    const ack = await service.ingest(DEVICE, { events: [vazio] })

    expect(ack.conflicts).toEqual([
      { eventId: vazio.eventId, reason: 'invalid_event', detail: expect.any(String) },
    ])
    expect(repository.saveEvent).not.toHaveBeenCalled()
  })

  // A fila do relógio chega embaralhada depois de uma reconexão. O início da
  // sessão não pode depender de qual evento o cliente pôs primeiro no array.
  it('abre a sessão com o horário do evento mais antigo do lote, não do primeiro', async () => {
    const { service, repository } = build()
    const recente = new Date(Date.now() - 5_000).toISOString()
    const antigo = new Date(Date.now() - 60_000).toISOString()

    await service.ingest(DEVICE, {
      events: [event({ sequence: 2, eventTime: recente }), event({ sequence: 1, eventTime: antigo })],
    })

    const [aberta] = repository.ensureSession.mock.calls[0]
    expect(aberta.startedAt.toISOString()).toBe(antigo)
  })
})

describe('avaliação de esforço e desgaste no caminho do evento', () => {
  it('lote ao vivo avalia a sessão uma vez, com o eventTime mais recente e antes do aviso', async () => {
    const { service, assessment, realtime } = build()
    const older = new Date(Date.now() - 10_000).toISOString()
    const newer = new Date(Date.now() - 2_000).toISOString()
    const order: string[] = []
    assessment.assessSession.mockImplementation(async () => {
      order.push('assess')
      return { outcome: 'assessed', assessmentId: 'a-1' }
    })
    realtime.emitToUsers.mockImplementation(() => {
      order.push('announce')
    })

    await service.ingest(DEVICE, {
      events: [event({ sequence: 1, eventTime: older }), event({ sequence: 2, eventTime: newer })],
    })

    expect(assessment.assessSession).toHaveBeenCalledTimes(1)
    const [sessionId, triggerAt] = assessment.assessSession.mock.calls[0]
    expect(sessionId).toBe(SESSION)
    expect(triggerAt.toISOString()).toBe(newer)
    expect(order).toEqual(['assess', 'announce'])
  })

  it('lote de backlog não avalia', async () => {
    const { service, assessment } = build()
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    await service.ingest(DEVICE, { events: [event({ eventTime: threeHoursAgo })] })
    expect(assessment.assessSession).not.toHaveBeenCalled()
  })

  it('evento duplicado não dispara avaliação', async () => {
    const { service, assessment, repository } = build()
    repository.saveEvent.mockResolvedValue(stored({ outcome: 'DUPLICATE' }))
    await service.ingest(DEVICE, { events: [event()] })
    expect(assessment.assessSession).not.toHaveBeenCalled()
  })

  it('duas sessões ao vivo no mesmo lote avaliam cada uma uma vez', async () => {
    const { service, assessment } = build()
    const other = randomUUID()
    await service.ingest(DEVICE, { events: [event(), event({ monitoringSessionId: other, sequence: 1 })] })
    expect(assessment.assessSession).toHaveBeenCalledTimes(2)
  })

  it('falha da avaliação não muda o ACK', async () => {
    const { service, assessment } = build()
    assessment.assessSession.mockRejectedValue(new Error('fórmula estourou'))
    const e = event()
    const ack = await service.ingest(DEVICE, { events: [e] })
    expect(ack.acceptedEventIds).toEqual([e.eventId])
    expect(ack.conflicts).toEqual([])
  })
})

// O motor de condições estava completo e testado, e mesmo assim era código
// morto: ninguém o chamava. O que estes casos protegem é a fiação, e o
// isolamento entre as duas avaliações: alerta é segurança, e um erro na
// fórmula de desgaste não pode ser o motivo de um alerta não sair.
describe('avaliação de condições no caminho do evento', () => {
  it('lote ao vivo avalia as condições da mesma sessão, com os mesmos argumentos e DEPOIS do esforço', async () => {
    const { service, assessment, conditions } = build()
    const newer = new Date(Date.now() - 2_000).toISOString()

    await service.ingest(DEVICE, { events: [event({ eventTime: newer })] })

    expect(conditions.evaluateSession).toHaveBeenCalledTimes(1)
    // Os MESMOS argumentos, e não argumentos parecidos: as duas avaliações
    // descrevem o mesmo instante do mesmo lote, e um `now` recalculado aqui
    // faria o corte de 15 s e o prazo de "ao vivo" medirem contra marcos
    // diferentes.
    expect(conditions.evaluateSession.mock.calls[0]).toEqual(assessment.assessSession.mock.calls[0])
    const [, triggerAt] = conditions.evaluateSession.mock.calls[0]
    expect(triggerAt.toISOString()).toBe(newer)
    // Pela ordem de chamada, e não só pela presença das duas.
    expect(conditions.evaluateSession.mock.invocationCallOrder[0]).toBeGreaterThan(
      assessment.assessSession.mock.invocationCallOrder[0],
    )
  })

  it('lote de backlog não avalia condição', async () => {
    // Condição descreve o AGORA. O serviço também se defende disso por dentro,
    // mas quem não deve nem chamar é daqui.
    const { service, conditions } = build()
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

    await service.ingest(DEVICE, { events: [event({ eventTime: threeHoursAgo })] })

    expect(conditions.evaluateSession).not.toHaveBeenCalled()
  })

  it('falha na avaliação de esforço não impede as condições, e não derruba o ACK', async () => {
    const { service, assessment, conditions } = build()
    assessment.assessSession.mockRejectedValue(new Error('fórmula estourou'))
    const aceito = event()

    const ack = await service.ingest(DEVICE, { events: [aceito] })

    expect(conditions.evaluateSession).toHaveBeenCalledTimes(1)
    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
    expect(ack.conflicts).toEqual([])
  })

  it('falha nas condições não derruba o ACK, e o esforço já tinha rodado', async () => {
    const { service, assessment, conditions } = build()
    conditions.evaluateSession.mockRejectedValue(new Error('motor estourou'))
    const aceito = event()

    const ack = await service.ingest(DEVICE, { events: [aceito] })

    expect(assessment.assessSession).toHaveBeenCalledTimes(1)
    // O evento já está gravado, e reenviá-lo só produziria duplicata.
    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
    expect(ack.conflicts).toEqual([])
  })

  it('vários eventos ao vivo da mesma sessão avaliam as condições uma vez só', async () => {
    const { service, conditions } = build()

    await service.ingest(DEVICE, { events: [event({ sequence: 1 }), event({ sequence: 2 })] })

    expect(conditions.evaluateSession).toHaveBeenCalledTimes(1)
  })
})

// Pressão e temperatura lidas do app Saúde chegam pelo iPhone, numa sessão que
// não é a do relógio. Mesmo medidas há segundos, não são sinal do relógio: se
// contassem como evento ao vivo, recuperariam uma perda de sinal que continua
// acontecendo e avaliariam esforço numa sessão sem batimento.
describe('medição avulsa do app Saúde', () => {
  const pressure = {
    bloodPressure: { value: { systolic: 128, diastolic: 82 }, unit: 'mmHg', source: 'EXTERNAL_CUFF' },
  }
  const temperature = {
    bodyTemperature: { value: 36.8, unit: '°C', source: 'MANUAL_HEALTHKIT' },
  }

  const fiveHoursAgo = () => new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()

  it('recém-medida não conta como evento ao vivo do relógio', async () => {
    const { service, assessment, conditions } = build()
    const aceito = event({ measurements: { ...pressure, ...temperature } })

    const ack = await service.ingest(DEVICE, { events: [aceito] })

    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
    expect(assessment.assessSession).not.toHaveBeenCalled()
    expect(conditions.evaluateSession).not.toHaveBeenCalled()
  })

  // A revisão de pressão não pode esperar o relógio falar: quem mediu de manhã
  // e abriu o app depois precisa cair na fila de revisão na hora em que a
  // medição chega, e não quando o monitoramento começar.
  it('avalia a medição ao chegar, tenha ela segundos ou horas', async () => {
    for (const eventTime of [new Date(Date.now() - 5_000).toISOString(), fiveHoursAgo()]) {
      const { service, conditions } = build()
      const aceito = event({ eventTime, measurements: pressure })

      const ack = await service.ingest(DEVICE, { events: [aceito] })

      expect(ack.acceptedEventIds).toEqual([aceito.eventId])
      expect(conditions.evaluateSpotReading).toHaveBeenCalledTimes(1)
      const [sessionId, now] = conditions.evaluateSpotReading.mock.calls[0]
      expect(sessionId).toBe(SESSION)
      expect(now).toBeInstanceOf(Date)
    }
  })

  // O iPhone manda cada medição numa sessão própria, e na primeira leitura
  // chegam dezenas de uma vez. A avaliação é por funcionário e origem, então
  // uma por lote basta: uma por medição seria a mesma conta repetida.
  it('várias medições no lote, cada uma na sua sessão, avaliam uma vez só; repetição não avalia', async () => {
    const { service, conditions, repository } = build()

    await service.ingest(DEVICE, {
      events: [
        event({ monitoringSessionId: randomUUID(), sequence: 0, eventTime: fiveHoursAgo(), measurements: pressure }),
        event({ monitoringSessionId: randomUUID(), sequence: 0, eventTime: fiveHoursAgo(), measurements: temperature }),
        event({ monitoringSessionId: randomUUID(), sequence: 0, measurements: pressure }),
      ],
    })
    expect(conditions.evaluateSpotReading).toHaveBeenCalledTimes(1)

    conditions.evaluateSpotReading.mockClear()
    repository.saveEvent.mockResolvedValue(stored({ outcome: 'DUPLICATE', snapshotPromoted: false }))
    await service.ingest(DEVICE, { events: [event({ measurements: pressure })] })
    expect(conditions.evaluateSpotReading).not.toHaveBeenCalled()
  })

  it('falha na avaliação da medição não derruba o ACK', async () => {
    const { service, conditions } = build()
    conditions.evaluateSpotReading.mockRejectedValue(new Error('motor estourou'))
    const aceito = event({ measurements: pressure })

    const ack = await service.ingest(DEVICE, { events: [aceito] })

    expect(ack.acceptedEventIds).toEqual([aceito.eventId])
    expect(ack.conflicts).toEqual([])
  })

  // Com o relógio falando no mesmo lote, a medição avulsa ainda tem a sua
  // avaliação: a do relógio lê a pressão só até o horário do evento dele, e
  // uma medição feita um segundo depois ficaria de fora.
  it('no mesmo lote, o evento do relógio avalia a sessão dele e a medição avulsa tem a sua', async () => {
    const { service, conditions } = build()
    const healthSession = randomUUID()

    await service.ingest(DEVICE, {
      events: [
        event({ sequence: 1 }),
        event({ monitoringSessionId: healthSession, sequence: 0, measurements: pressure }),
      ],
    })

    expect(conditions.evaluateSession).toHaveBeenCalledTimes(1)
    expect(conditions.evaluateSession.mock.calls[0][0]).toBe(SESSION)
    expect(conditions.evaluateSpotReading).toHaveBeenCalledTimes(1)
    expect(conditions.evaluateSpotReading.mock.calls[0][0]).toBe(healthSession)
  })
})
