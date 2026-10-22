import { NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { CONDITION_HISTORY_PAGE, ConditionHistoryService } from './condition-history.service'

// O que estes casos protegem: quem pode ler o histórico de quem, o que cada
// item diz (o motivo do fechamento acima de tudo) e a paginação. Prisma é
// dublê; o escopo contra banco real e o motivo gravado pela varredura estão no
// e2e.

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }
const OPENED = new Date('2026-10-01T14:50:00.000Z')
const CLOSED = new Date('2026-10-02T14:50:00.000Z')

const conditionRow = (over: Record<string, unknown> = {}) => ({
  id: 'cond-1',
  origin: 'REAL',
  kind: 'BLOOD_PRESSURE_HIGH',
  status: 'RECOVERED',
  firstSeenAt: OPENED,
  recoveredAt: CLOSED,
  recoveryReason: 'NO_NEW_READING',
  observedValue: 185,
  thresholdValue: 180,
  receivedAt: null,
  episodeKind: null,
  ...over,
})

const prismaDouble = () =>
  ({
    user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1', role: 'WORKER' }) },
    telemetryCondition: { findMany: jest.fn().mockResolvedValue([]) },
  }) as any

const service = (prisma: any) => new ConditionHistoryService(prisma as PrismaService)

describe('ConditionHistoryService.list: o que cada item diz', () => {
  it('abertas e fechadas, com o motivo do fechamento, mais nova primeiro, só origem real', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      conditionRow({ id: 'cond-2', kind: 'HEART_RATE_HIGH', status: 'ACTIVE', recoveredAt: null, recoveryReason: null }),
      conditionRow(),
    ])

    const page = await service(prisma).list(ADMIN, 'worker-1')

    const args = prisma.telemetryCondition.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ workerId: 'worker-1', origin: { in: ['REAL'] } })
    expect(args.orderBy).toEqual([{ firstSeenAt: 'desc' }, { id: 'desc' }])
    expect(page).toEqual({
      items: [
        {
          id: 'cond-2',
          origin: 'REAL',
          kind: 'HEART_RATE_HIGH',
          category: 'URGENT',
          status: 'ACTIVE',
          openedAt: OPENED.toISOString(),
          recoveredAt: null,
          recoveryReason: null,
          observedValue: 185,
          thresholdValue: 180,
          receivedAt: null,
          episodeKind: null,
        },
        {
          id: 'cond-1',
          origin: 'REAL',
          kind: 'BLOOD_PRESSURE_HIGH',
          category: 'URGENT',
          status: 'RECOVERED',
          openedAt: OPENED.toISOString(),
          recoveredAt: CLOSED.toISOString(),
          recoveryReason: 'NO_NEW_READING',
          observedValue: 185,
          thresholdValue: 180,
          receivedAt: null,
          episodeKind: null,
        },
      ],
      nextCursor: null,
    })
  })

  it('perda de sinal entra no histórico, mesmo sem alerta nenhum', async () => {
    // É a única que fecha por "Sinal restabelecido", e a fila nunca a mostra.
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      conditionRow({ kind: 'DEVICE_SIGNAL_LOST', recoveryReason: 'SIGNAL_RESTORED' }),
    ])

    const page = await service(prisma).list(ADMIN, 'worker-1')

    expect(page.items[0]).toMatchObject({ category: 'DEVICE', recoveryReason: 'SIGNAL_RESTORED' })
  })

  it('episódio atrasado diz quando o lote chegou; episódios repetidos dizem o tipo repetido', async () => {
    const received = new Date('2026-10-02T18:00:00.000Z')
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue([
      conditionRow({
        id: 'rep',
        kind: 'REPEATED_EPISODES',
        episodeKind: 'HEART_RATE_HIGH',
        recoveryReason: 'NORMALIZED',
        receivedAt: received,
        observedValue: 3,
        thresholdValue: 3,
      }),
      conditionRow({ id: 'ep', kind: 'HEART_RATE_HIGH', recoveryReason: 'NORMALIZED', receivedAt: received }),
    ])

    const page = await service(prisma).list(ADMIN, 'worker-1')

    expect(page.items[0]).toMatchObject({
      kind: 'REPEATED_EPISODES',
      category: 'HEALTH',
      episodeKind: 'HEART_RATE_HIGH',
      receivedAt: received.toISOString(),
      observedValue: 3,
      thresholdValue: 3,
    })
    expect(page.items[1]).toMatchObject({ kind: 'HEART_RATE_HIGH', episodeKind: null, receivedAt: received.toISOString() })
  })

  it('com a demonstração liberada na homologação, ela aparece e diz a própria origem', async () => {
    const before = process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
    process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = '1'
    try {
      const prisma = prismaDouble()
      await service(prisma).list(ADMIN, 'worker-1')
      expect(prisma.telemetryCondition.findMany.mock.calls[0][0].where.origin).toEqual({ in: ['REAL', 'DEMO'] })
    } finally {
      if (before === undefined) delete process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
      else process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = before
    }
  })
})

describe('ConditionHistoryService.list: paginação', () => {
  it('pede um a mais que a página e devolve o id do último como próximo cursor', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockResolvedValue(
      Array.from({ length: CONDITION_HISTORY_PAGE + 1 }, (_, i) => conditionRow({ id: `c-${i}` })),
    )

    const page = await service(prisma).list(ADMIN, 'worker-1', 'c-anterior')

    const args = prisma.telemetryCondition.findMany.mock.calls[0][0]
    expect(args.take).toBe(CONDITION_HISTORY_PAGE + 1)
    expect(args.cursor).toEqual({ id: 'c-anterior' })
    expect(args.skip).toBe(1)
    expect(page.items).toHaveLength(CONDITION_HISTORY_PAGE)
    expect(page.nextCursor).toBe(`c-${CONDITION_HISTORY_PAGE - 1}`)
  })
})

describe('ConditionHistoryService.list: quem pode ler', () => {
  it.each([
    ['de outra empresa', { companyId: 'company-2', role: 'WORKER' }, ADMIN],
    ['que não é funcionário', { companyId: 'company-1', role: 'ADMIN' }, ADMIN],
    ['inexistente', null, ADMIN],
    ['pedido por quem não tem empresa', { companyId: 'company-1', role: 'WORKER' }, { ...ADMIN, companyId: null }],
  ])('funcionário %s responde 404, sem ler condição nenhuma', async (_caso, user, caller) => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(user)

    await expect(service(prisma).list(caller, 'worker-1')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.telemetryCondition.findMany).not.toHaveBeenCalled()
  })
})
