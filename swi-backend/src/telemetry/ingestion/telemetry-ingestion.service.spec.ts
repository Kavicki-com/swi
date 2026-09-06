import { randomUUID } from 'node:crypto'
import type { RealtimeGateway } from '../../realtime/realtime.gateway'
import type { TelemetryAssessmentService } from '../assessment/assessment.service'
import type { DeviceIdentity } from '../devices/device-auth.service'
import {
  TelemetryIntegrityConflictError,
  TelemetrySessionNotFoundError,
  type SaveEventResult,
} from '../persistence/telemetry.repository'
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

const build = () => {
  const repository = repositoryDouble()
  const realtime = realtimeDouble()
  const assessment = assessmentDouble()
  const service = new TelemetryIngestionService(
    repository,
    realtime as unknown as RealtimeGateway,
    assessment as unknown as TelemetryAssessmentService,
  )
  return { repository, realtime, assessment, service }
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
  // já aplicou, e é o campo que a Task 13 exige no contrato de realtime.
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
