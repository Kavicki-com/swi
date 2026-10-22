import { requestHash } from '../../idempotency/idempotency-key'
import type { PrismaService } from '../../prisma/prisma.service'
import { CONDITION_CHANGED_EVENT } from '../alerts/condition.service'
import {
  HELP_REQUEST_CHANGED_EVENT,
  HELP_REQUEST_PROFILE,
  HelpRequestService,
  RESCUE_ENDED_NOTE,
  helpStatusOf,
  openHelpRequestsOf,
} from './help-request.service'

// Prisma é dublê aqui: a trava contra o toque duplo, a chave de idempotência e
// o vínculo com o resgate contra o banco real estão no e2e.

const NOW = new Date('2026-10-22T12:00:00.000Z')

const alertRow = (over: Record<string, unknown> = {}) => ({
  id: 'help-1',
  status: 'OPEN',
  createdAt: NOW,
  acknowledgedAt: null,
  resolvedAt: null,
  updatedAt: NOW,
  rescues: [],
  ...over,
})

const prismaDouble = () => {
  const db: any = {
    operationalAlert: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(alertRow()),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'help-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    telemetryCondition: { create: jest.fn().mockResolvedValue({ id: 'cond-1' }) },
    idempotencyKey: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    $executeRaw: jest.fn().mockResolvedValue(1),
  }
  db.$transaction = jest.fn(async (fn: any) => fn(db))
  return db
}

const make = (db = prismaDouble()) => {
  const realtime = { emitToUsers: jest.fn() }
  const audience = { recipientsFor: jest.fn().mockResolvedValue(['worker-1', 'admin-1']) }
  const notifier = { notifyOpened: jest.fn().mockResolvedValue(undefined) }
  const svc = new HelpRequestService(db as PrismaService, realtime as any, audience as any, notifier as any)
  return { svc, db, realtime, audience, notifier }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('HelpRequestService.request', () => {
  it('abre condição recuperada e alerta urgente aberto, sob a trava do funcionário, e avisa', async () => {
    const { svc, db, realtime, notifier } = make()

    const view = await svc.request('worker-1', undefined, NOW)
    await flush()

    expect(db.$executeRaw.mock.calls[0].slice(1)).toEqual(['help:worker-1'])
    expect(db.telemetryCondition.create.mock.calls[0][0].data).toEqual({
      workerId: 'worker-1',
      origin: 'REAL',
      kind: 'HELP_REQUESTED',
      status: 'RECOVERED',
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      recoveredAt: NOW,
      thresholdProfile: HELP_REQUEST_PROFILE,
    })
    expect(db.operationalAlert.create.mock.calls[0][0].data).toEqual({
      conditionId: 'cond-1',
      workerId: 'worker-1',
      origin: 'REAL',
      status: 'OPEN',
      createdAt: NOW,
    })
    const change = {
      workerId: 'worker-1',
      conditionId: 'cond-1',
      kind: 'HELP_REQUESTED',
      change: 'OPENED',
      at: NOW.toISOString(),
    }
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1', 'admin-1'], CONDITION_CHANGED_EVENT, change)
    expect(notifier.notifyOpened).toHaveBeenCalledWith([change])
    expect(realtime.emitToUsers).toHaveBeenCalledWith(['worker-1', 'admin-1'], HELP_REQUEST_CHANGED_EVENT, {
      workerId: 'worker-1',
      helpRequestId: 'help-1',
      status: 'OPEN',
      at: NOW.toISOString(),
    })
    expect(view).toEqual({
      id: 'help-1',
      status: 'OPEN',
      createdAt: NOW.toISOString(),
      attendedAt: null,
      closedAt: null,
      rescue: null,
    })
  })

  it('com pedido aberto ou atendido, devolve o mesmo sem abrir nem avisar', async () => {
    const { svc, db, realtime, notifier } = make()
    db.operationalAlert.findFirst.mockResolvedValue({ id: 'help-0' })
    db.operationalAlert.findUnique.mockResolvedValue(
      alertRow({ id: 'help-0', status: 'ACKNOWLEDGED', acknowledgedAt: NOW }),
    )

    const view = await svc.request('worker-1', undefined, NOW)

    expect(db.telemetryCondition.create).not.toHaveBeenCalled()
    expect(db.operationalAlert.create).not.toHaveBeenCalled()
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
    expect(notifier.notifyOpened).not.toHaveBeenCalled()
    expect(view.id).toBe('help-0')
    expect(view.status).toBe('ATTENDED')
  })

  it('com chave já usada, devolve o pedido da chave sem abrir outro', async () => {
    const { svc, db, realtime } = make()
    db.idempotencyKey.findUnique.mockResolvedValue({
      scope: 'help.request',
      requestHash: requestHash('help.request', {}),
      resourceId: 'help-9',
    })
    db.operationalAlert.findUnique.mockResolvedValue(alertRow({ id: 'help-9', status: 'RESOLVED', resolvedAt: NOW }))

    const view = await svc.request('worker-1', '6f1c2b0e-8a4d-4c3e-9b1a-2d3e4f5a6b7c', NOW)

    expect(db.telemetryCondition.create).not.toHaveBeenCalled()
    expect(realtime.emitToUsers).not.toHaveBeenCalled()
    expect(view).toMatchObject({ id: 'help-9', status: 'CLOSED', closedAt: NOW.toISOString() })
  })

  it('chave nova grava a chave com o pedido aberto, na mesma transação', async () => {
    const { svc, db } = make()

    await svc.request('worker-1', '6f1c2b0e-8a4d-4c3e-9b1a-2d3e4f5a6b7c', NOW)

    expect(db.idempotencyKey.create.mock.calls[0][0].data).toMatchObject({
      userId: 'worker-1',
      scope: 'help.request',
      resourceId: 'help-1',
    })
  })

  it('falha do aviso não derruba o pedido já gravado', async () => {
    const { svc, audience, notifier } = make()
    audience.recipientsFor.mockRejectedValue(new Error('sem rede'))
    notifier.notifyOpened.mockRejectedValue(new Error('fila fora'))

    await expect(svc.request('worker-1', undefined, NOW)).resolves.toMatchObject({ id: 'help-1', status: 'OPEN' })
    await flush()
  })
})

describe('HelpRequestService: leitura do próprio pedido', () => {
  it('sem pedido nenhum devolve nulo', async () => {
    const { svc, db } = make()
    db.operationalAlert.findFirst.mockResolvedValue(null)
    expect(await svc.mine('worker-1')).toBeNull()
  })

  it('com socorrista despachado, traz o resgate e a última posição dele, e só isso', async () => {
    const { svc, db } = make()
    db.operationalAlert.findFirst.mockResolvedValue({ id: 'help-1' })
    db.operationalAlert.findUnique.mockResolvedValue(
      alertRow({
        status: 'ACKNOWLEDGED',
        acknowledgedAt: NOW,
        rescues: [
          {
            id: 'rescue-1',
            status: 'dispatched',
            startedAt: NOW,
            arrivedAt: null,
            rescuer: { position: { lat: -3.1, lng: -60.02, recordedAt: NOW } },
          },
        ],
      }),
    )

    expect(await svc.mine('worker-1')).toEqual({
      id: 'help-1',
      status: 'ATTENDED',
      createdAt: NOW.toISOString(),
      attendedAt: NOW.toISOString(),
      closedAt: null,
      rescue: {
        id: 'rescue-1',
        status: 'dispatched',
        dispatchedAt: NOW.toISOString(),
        arrivedAt: null,
        rescuerPosition: { lat: -3.1, lng: -60.02, recordedAt: NOW.toISOString() },
      },
    })
    expect(db.operationalAlert.findFirst.mock.calls[0][0].where).toEqual({
      workerId: 'worker-1',
      condition: { kind: 'HELP_REQUESTED' },
    })
  })

  it('resgate encerrado, ou socorrista sem posição, não leva posição', async () => {
    const { svc, db } = make()
    db.operationalAlert.findFirst.mockResolvedValue({ id: 'help-1' })
    const rescue = (status: string, position: unknown) => ({
      id: 'rescue-1',
      status,
      startedAt: NOW,
      arrivedAt: NOW,
      rescuer: { position },
    })
    db.operationalAlert.findUnique.mockResolvedValueOnce(
      alertRow({ status: 'RESOLVED', resolvedAt: NOW, rescues: [rescue('ended', { lat: 1, lng: 2, recordedAt: NOW })] }),
    )
    expect((await svc.mine('worker-1'))?.rescue?.rescuerPosition).toBeNull()

    db.operationalAlert.findUnique.mockResolvedValueOnce(alertRow({ rescues: [rescue('arrived', null)] }))
    expect((await svc.mine('worker-1'))?.rescue?.rescuerPosition).toBeNull()
  })

  it('dispensado fecha pela última mudança do alerta', async () => {
    const { svc, db } = make()
    const later = new Date(NOW.getTime() + 60_000)
    db.operationalAlert.findFirst.mockResolvedValue({ id: 'help-1' })
    db.operationalAlert.findUnique.mockResolvedValue(alertRow({ status: 'DISMISSED', updatedAt: later }))
    expect((await svc.mine('worker-1'))?.closedAt).toBe(later.toISOString())
  })
})

describe('HelpRequestService: resgate', () => {
  it('despacho marca atendido o pedido aberto e devolve o vínculo', async () => {
    const { svc, db, realtime } = make()
    db.operationalAlert.findFirst.mockResolvedValue({ id: 'help-1', status: 'OPEN' })

    expect(await svc.attendByRescue('worker-1', 'admin-1', NOW)).toBe('help-1')
    await flush()

    expect(db.operationalAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'help-1', status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: NOW, triagedById: 'admin-1' },
    })
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      HELP_REQUEST_CHANGED_EVENT,
      expect.objectContaining({ status: 'ATTENDED' }),
    )
  })

  it('pedido já atendido no painel só ganha o vínculo; sem pedido, nada', async () => {
    const { svc, db } = make()
    db.operationalAlert.findFirst.mockResolvedValueOnce({ id: 'help-1', status: 'ACKNOWLEDGED' })
    expect(await svc.attendByRescue('worker-1', 'admin-1', NOW)).toBe('help-1')
    expect(db.operationalAlert.updateMany).not.toHaveBeenCalled()

    db.operationalAlert.findFirst.mockResolvedValueOnce(null)
    expect(await svc.attendByRescue('worker-1', 'admin-1', NOW)).toBeNull()
  })

  it('encerramento fecha o pedido ainda não fechado, com nota', async () => {
    const { svc, db, realtime } = make()
    db.operationalAlert.findUnique.mockResolvedValue({ workerId: 'worker-1' })

    await svc.closeByRescue('help-1', 'sup-1', NOW)
    await flush()

    expect(db.operationalAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'help-1', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: NOW, triagedById: 'sup-1', resolutionNote: RESCUE_ENDED_NOTE },
    })
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      HELP_REQUEST_CHANGED_EVENT,
      expect.objectContaining({ status: 'CLOSED' }),
    )
  })

  it('pedido já fechado, ou apagado, não muda nem avisa', async () => {
    const { svc, db, realtime } = make()
    db.operationalAlert.findUnique.mockResolvedValueOnce({ workerId: 'worker-1' })
    db.operationalAlert.updateMany.mockResolvedValueOnce({ count: 0 })
    await svc.closeByRescue('help-1', 'sup-1', NOW)

    db.operationalAlert.findUnique.mockResolvedValueOnce(null)
    await svc.closeByRescue('help-x', 'sup-1', NOW)
    await flush()

    expect(realtime.emitToUsers).not.toHaveBeenCalled()
  })

  it('falha do aviso de mudança fica no log', async () => {
    const { svc, audience } = make()
    audience.recipientsFor.mockRejectedValue(new Error('sem rede'))
    svc.announceChanged('worker-1', 'help-1', 'CLOSED', NOW)
    await flush()
  })
})

describe('openHelpRequestsOf e helpStatusOf', () => {
  it('sem funcionários não consulta; com, um por pessoa, o mais novo', async () => {
    const db = prismaDouble()
    expect(await openHelpRequestsOf(db, [])).toEqual(new Map())
    expect(db.operationalAlert.findMany).not.toHaveBeenCalled()

    db.operationalAlert.findMany.mockResolvedValue([
      { id: 'velho', workerId: 'w1', status: 'OPEN', createdAt: NOW, rescues: [] },
      { id: 'novo', workerId: 'w1', status: 'OPEN', createdAt: NOW, rescues: [] },
    ])
    expect((await openHelpRequestsOf(db, ['w1'])).get('w1')).toEqual({
      id: 'novo',
      status: 'OPEN',
      createdAt: NOW.toISOString(),
      rescueId: null,
    })
  })

  it('o estado do pedido sai do estado do alerta', () => {
    expect(helpStatusOf('OPEN')).toBe('OPEN')
    expect(helpStatusOf('ACKNOWLEDGED')).toBe('ATTENDED')
    expect(helpStatusOf('RESOLVED')).toBe('CLOSED')
    expect(helpStatusOf('DISMISSED')).toBe('CLOSED')
  })
})
