import { randomUUID } from 'node:crypto'
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { requestHash, type IdempotencyScope } from '../idempotency/idempotency-key'

// Ações da jornada vindas da fila offline do app: valem na hora do toque e
// não se repetem quando o mesmo envio chega duas vezes.

const KEY = randomUUID()
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const media = () => ({
  presignGetMany: jest.fn(async (ks: string[]) => ks.map((k) => `signed:${k}`)),
  presignGet: jest.fn(async (k: string) => `signed:${k}`),
}) as any

const prisma = () => {
  const db: any = {
    journey: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn(), update: jest.fn() },
    task: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    workOrder: { update: jest.fn().mockResolvedValue({}) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  db.$transaction = jest.fn(async (cb: any) => cb(db))
  return db
}

const orderRow = () => ({
  id: 'o1', summary: 'Checklist', imageKeys: ['order/a.jpg'],
  responsibles: [{ id: 'u1', name: 'Worker Demo', profile: { fullName: 'Worker Demo', avatarKey: null } }],
})
const taskRow = (over: any = {}) => ({
  id: 't1', orderId: 'o1', position: 0, title: 'Inspeção', description: 'd',
  estimatedMinutes: 120, status: 'pending', startedAt: null, accumulatedSeconds: 0,
  progressPct: 0, order: orderRow(), ...over,
})
const journeyRow = (over = {}) => ({
  id: 'j1', workerId: 'u1', date: day('2026-10-04'), state: 'idle',
  activeTaskId: null, startedAt: null, accumulatedSeconds: 0, openedAt: null, ...over,
})
const fresh = (over = {}) => ({ status: 'pending', startedAt: null, accumulatedSeconds: 0, ...over })

/** Banco em que a tarefa t1 e a jornada j1 existem e toda gravação devolve a linha com os dados novos. */
function ready(task: any = {}, journey: any = {}) {
  const db = prisma()
  db.task.findFirst.mockResolvedValue(taskRow(task))
  db.task.findUnique.mockResolvedValue(fresh(task))
  db.task.update.mockImplementation(({ data }: any) => ({ ...taskRow(task), ...data }))
  db.journey.upsert.mockResolvedValue(journeyRow(journey))
  db.journey.update.mockImplementation(({ data }: any) => ({ ...journeyRow(journey), ...data }))
  return db
}

const NOW = '2026-10-04T18:00:00.000Z' // 15h em Brasília
const MIN = 60_000
const nowMs = Date.parse(NOW)
/** Um envio tocado `waitedMin` minutos antes de sair do aparelho. */
const touched = (waitedMin: number, key?: string) => ({
  key,
  occurredAt: new Date(nowMs - waitedMin * MIN).toISOString(),
  sentAt: NOW,
})

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
  jest.setSystemTime(new Date(NOW))
})
afterEach(() => jest.useRealTimers())

describe('JourneyService: hora do toque', () => {
  it('iniciar tocado 30 min antes do envio conta a tarefa e o turno da hora do toque', async () => {
    const db = ready()
    const out = await new JourneyService(db, media()).startTask('u1', 't1', touched(30))

    const at = new Date(nowMs - 30 * MIN)
    expect(db.task.update.mock.calls[0][0].data.startedAt).toEqual(at)
    expect(db.journey.update.mock.calls[0][0].data.startedAt).toEqual(at)
    expect(db.journey.update.mock.calls[0][0].data.openedAt).toEqual(at)
    expect(out.task.startedAt).toBe(at.toISOString())
  })

  it('pausar tocado 10 min antes do envio fecha a conta na hora do toque', async () => {
    const startedAt = new Date(nowMs - 60 * MIN)
    const db = ready({}, { state: 'ongoing', startedAt, openedAt: startedAt })
    await new JourneyService(db, media()).pauseJourney('u1', touched(10))

    expect(db.journey.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ state: 'paused', startedAt: null, accumulatedSeconds: 50 * 60 }),
    )
  })

  it('a tarefa ativa também fecha a conta na hora do toque', async () => {
    const startedAt = new Date(nowMs - 60 * MIN)
    const db = ready({ status: 'in_progress', startedAt }, { state: 'ongoing', activeTaskId: 't1', startedAt, openedAt: startedAt })
    await new JourneyService(db, media()).endJourney('u1', touched(15))

    expect(db.task.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'paused', accumulatedSeconds: 45 * 60 }),
    )
  })

  // Sem isto o "encerrar" que ficou na fila de ontem cairia na jornada ociosa
  // de hoje, e o turno de ontem ficaria aberto com a tarefa correndo.
  it('encerrar tocado ontem e enviado hoje procura a jornada do dia do toque', async () => {
    jest.setSystemTime(new Date('2026-10-05T12:00:00.000Z')) // 09h de Brasília
    const send = { occurredAt: '2026-10-04T20:00:00.000Z', sentAt: '2026-10-05T12:00:00.000Z' } // toque às 17h de ontem
    const db = ready({}, { state: 'ongoing', startedAt: new Date('2026-10-04T11:00:00.000Z'), openedAt: new Date('2026-10-04T11:00:00.000Z') })
    await new JourneyService(db, media()).endJourney('u1', send)

    expect(db.journey.upsert.mock.calls[0][0].where.workerId_date.date).toEqual(day('2026-10-04'))
    expect(db.journey.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'u1',
      date: { lt: day('2026-10-04') },
      state: { in: ['ongoing', 'paused'] },
      openedAt: { gt: new Date('2026-10-04T06:00:00.000Z') }, // hora do toque menos 14 h
    })
  })

  it('sem a hora do toque vale a hora do servidor', async () => {
    const db = ready()
    await new JourneyService(db, media()).startTask('u1', 't1')
    expect(db.task.update.mock.calls[0][0].data.startedAt).toEqual(new Date(NOW))
  })

  it('ação tocada há mais de 72 h é recusada antes de mexer no banco', async () => {
    const db = ready()
    const send = touched(72 * 60 + 1)
    await expect(new JourneyService(db, media()).startTask('u1', 't1', send)).rejects.toBeInstanceOf(UnprocessableEntityException)
    await expect(new JourneyService(db, media()).endJourney('u1', send)).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.idempotencyKey.findUnique).not.toHaveBeenCalled()
  })

  it('hora do toque sem a hora do envio é recusada', async () => {
    const db = ready()
    await expect(
      new JourneyService(db, media()).pauseJourney('u1', { occurredAt: NOW }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('JourneyService: envio repetido', () => {
  const known = (scope: IdempotencyScope, request: unknown, resourceId: string) => ({
    id: 'k1', userId: 'u1', key: KEY, scope, requestHash: requestHash(scope, request), resourceId, createdAt: new Date(),
  })

  it('sem chave não lê nem grava chave de envio', async () => {
    const db = ready()
    await new JourneyService(db, media()).startTask('u1', 't1', touched(5))
    expect(db.idempotencyKey.findUnique).not.toHaveBeenCalled()
    expect(db.idempotencyKey.create).not.toHaveBeenCalled()
  })

  it('com chave, a transição e a chave entram na mesma transação', async () => {
    const db = ready()
    const send = touched(5, KEY)
    await new JourneyService(db, media()).startTask('u1', 't1', send)

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.task.update).toHaveBeenCalledTimes(1)
    expect(db.idempotencyKey.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1', key: KEY, scope: 'journey.task.start',
        requestHash: requestHash('journey.task.start', { taskId: 't1', occurredAt: send.occurredAt }),
        resourceId: 't1',
      },
    })
  })

  // A hora do envio muda a cada tentativa: fica fora do que identifica o envio.
  it('reenvio com a mesma chave não repete a transição e devolve o estado atual', async () => {
    const send = touched(5, KEY)
    const db = ready({ status: 'in_progress' }, { state: 'ongoing', activeTaskId: 't1' })
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.task.start', { taskId: 't1', occurredAt: send.occurredAt }, 't1'))

    const later = { ...send, sentAt: new Date(nowMs + 5 * MIN).toISOString() }
    const out = await new JourneyService(db, media()).startTask('u1', 't1', later)

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.journey.update).not.toHaveBeenCalled()
    expect(db.idempotencyKey.create).not.toHaveBeenCalled()
    expect(out.task.status).toBe('in_progress')
    expect(out.journey).toEqual(expect.objectContaining({ state: 'ongoing', activeTaskId: 't1' }))
  })

  it('mesma chave com outra hora do toque é recusada, sem transição', async () => {
    const db = ready()
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.task.start', { taskId: 't1', occurredAt: NOW }, 't1'))
    await expect(
      new JourneyService(db, media()).startTask('u1', 't1', touched(5, KEY)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(db.task.update).not.toHaveBeenCalled()
  })

  it('mesma chave em outra ação é recusada', async () => {
    const send = touched(5, KEY)
    const db = ready()
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.task.start', { taskId: 't1', occurredAt: send.occurredAt }, 't1'))
    await expect(
      new JourneyService(db, media()).completeTask('u1', 't1', send),
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(db.task.update).not.toHaveBeenCalled()
  })

  it('reenvio de ação em tarefa que deixou de existir é 404', async () => {
    const send = touched(5, KEY)
    const db = ready()
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.task.cancel', { taskId: 't1', occurredAt: send.occurredAt }, 't1'))
    db.task.findFirst.mockResolvedValue(null)
    await expect(new JourneyService(db, media()).cancelTask('u1', 't1', send)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('reenvio de ação do turno devolve a jornada de agora, sem repetir', async () => {
    const send = touched(5, KEY)
    const db = ready({}, { state: 'idle' })
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.end', { occurredAt: send.occurredAt }, 'j1'))
    const out = await new JourneyService(db, media()).endJourney('u1', send)

    expect(db.journey.update).not.toHaveBeenCalled()
    expect(out).toEqual({ state: 'idle', activeTaskId: null, startedAt: null, accumulatedSeconds: 0 })
  })

  // A espera cresce a cada tentativa. Se a primeira valeu e a resposta se
  // perdeu, a seguinte não pode virar recusa só porque passou do teto.
  it('reenvio de ação já aplicada devolve o estado mesmo com a espera acima de 72 h', async () => {
    const send = touched(72 * 60 + 5, KEY)
    const db = ready({}, { state: 'paused' })
    db.idempotencyKey.findUnique.mockResolvedValue(known('journey.pause', { occurredAt: send.occurredAt }, 'j1'))
    const out = await new JourneyService(db, media()).pauseJourney('u1', send)
    expect(out.state).toBe('paused')
    expect(db.journey.update).not.toHaveBeenCalled()
  })

  it('primeiro envio com chave e espera acima de 72 h é recusado, sem transição e sem chave', async () => {
    const db = ready()
    await expect(
      new JourneyService(db, media()).startTask('u1', 't1', touched(72 * 60 + 5, KEY)),
    ).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.journey.update).not.toHaveBeenCalled()
    expect(db.idempotencyKey.create).not.toHaveBeenCalled()
  })

  // Com o mesmo objeto servindo de banco e de transação, uma gravação feita
  // fora da transação passaria despercebida.
  it('com chave, toda gravação da ação passa pela transação que grava a chave', async () => {
    const db = ready()
    const tx = ready()
    tx.idempotencyKey = { create: jest.fn().mockResolvedValue({}) }
    db.$transaction = jest.fn(async (cb: any) => cb(tx))
    await new JourneyService(db, media()).startTask('u1', 't1', touched(5, KEY))

    expect(tx.task.update).toHaveBeenCalledTimes(1)
    expect(tx.journey.update).toHaveBeenCalledTimes(1)
    expect(tx.workOrder.update).toHaveBeenCalledTimes(1) // estado da ordem recalculado
    expect(tx.idempotencyKey.create).toHaveBeenCalledTimes(1)
    expect(db.task.update).not.toHaveBeenCalled()
    expect(db.journey.update).not.toHaveBeenCalled()
    expect(db.journey.upsert).not.toHaveBeenCalled()
    expect(db.workOrder.update).not.toHaveBeenCalled()
  })

  it('erro na transição não grava a chave', async () => {
    const db = ready({ status: 'done' })
    await expect(new JourneyService(db, media()).startTask('u1', 't1', touched(5, KEY))).rejects.toThrow(/já concluída/)
    expect(db.idempotencyKey.create).not.toHaveBeenCalled()
  })

  const cases: [string, IdempotencyScope, (s: JourneyService, send: any) => Promise<unknown>, (occurredAt: string) => unknown, string][] = [
    ['iniciar', 'journey.task.start', (s, send) => s.startTask('u1', 't1', send), (occurredAt) => ({ taskId: 't1', occurredAt }), 't1'],
    ['concluir', 'journey.task.complete', (s, send) => s.completeTask('u1', 't1', send), (occurredAt) => ({ taskId: 't1', occurredAt }), 't1'],
    ['cancelar', 'journey.task.cancel', (s, send) => s.cancelTask('u1', 't1', send), (occurredAt) => ({ taskId: 't1', occurredAt }), 't1'],
    ['pausar', 'journey.pause', (s, send) => s.pauseJourney('u1', send), (occurredAt) => ({ occurredAt }), 'j1'],
    ['retomar', 'journey.resume', (s, send) => s.resumeJourney('u1', send), (occurredAt) => ({ occurredAt }), 'j1'],
    ['encerrar', 'journey.end', (s, send) => s.endJourney('u1', send), (occurredAt) => ({ occurredAt }), 'j1'],
  ]

  it.each(cases)('%s grava a chave com o escopo e o registro da própria ação', async (_name, scope, act, request, resourceId) => {
    const send = touched(5, KEY)
    const db = ready()
    await act(new JourneyService(db, media()), send)
    expect(db.idempotencyKey.create).toHaveBeenCalledWith({
      data: { userId: 'u1', key: KEY, scope, requestHash: requestHash(scope, request(send.occurredAt)), resourceId },
    })
  })

  it('chave sem hora do toque identifica o envio só pela ação', async () => {
    const db = ready()
    await new JourneyService(db, media()).pauseJourney('u1', { key: KEY })
    expect(db.idempotencyKey.create.mock.calls[0][0].data.requestHash).toBe(requestHash('journey.pause', { occurredAt: null }))
  })
})

describe('JourneyService: foto da tarefa sem repetir', () => {
  // Que a foto repetida não entra de novo é condição do UPDATE, provada no e2e.
  it('a foto entra por um UPDATE só, condicionado no banco', async () => {
    const db = ready()
    await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'task/b.jpg')

    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect(db.$executeRaw.mock.calls[0][0].join('?')).toMatch(/NOT \(\? = ANY\(COALESCE\("imageKeys"/)
    expect(db.workOrder.update).not.toHaveBeenCalled()
  })

  it('foto repetida não é erro: devolve a tarefa como está', async () => {
    const db = ready()
    db.$executeRaw.mockResolvedValue(0)
    const out = await new JourneyService(db, media()).addTaskPhoto('u1', 't1', 'order/a.jpg')
    expect(out.images).toEqual(['signed:order/a.jpg'])
  })
})
