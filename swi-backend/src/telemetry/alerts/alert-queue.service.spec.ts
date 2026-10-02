import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { AlertQueueService, alertCategory } from './alert-queue.service'

// O que estes casos protegem é a triagem da fila: quem vê qual alerta, o que
// cada verbo faz com o estado e que repetir um verbo não estraga nada. Prisma
// é dublê aqui; escopo de empresa e transição condicional contra banco real
// estão no e2e.

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }
const NOW = new Date('2026-10-01T15:00:00.000Z')
const OPENED = new Date('2026-10-01T14:50:00.000Z')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'alert-1',
  origin: 'REAL',
  status: 'OPEN',
  createdAt: OPENED,
  acknowledgedAt: null,
  resolvedAt: null,
  resolutionNote: null,
  triagedBy: null,
  worker: { id: 'worker-1', name: 'Ana', profile: { sector: 'Leste' } },
  condition: {
    kind: 'HEART_RATE_HIGH',
    observedValue: 185,
    thresholdValue: 165,
    firstSeenAt: OPENED,
    recoveredAt: null,
  },
  ...over,
})

const prismaDouble = () =>
  ({
    operationalAlert: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }) as any

const service = (prisma: any) => new AlertQueueService(prisma as PrismaService)

describe('alertCategory', () => {
  it('batimento fora da faixa é urgência, saúde sem urgência é HEALTH, aparelho é DEVICE', () => {
    expect(alertCategory('HEART_RATE_HIGH')).toBe('URGENT')
    expect(alertCategory('HEART_RATE_LOW')).toBe('URGENT')
    expect(alertCategory('WEAR_HIGH')).toBe('HEALTH')
    expect(alertCategory('BLOOD_PRESSURE_REVIEW')).toBe('HEALTH')
    expect(alertCategory('DEVICE_BATTERY_LOW')).toBe('DEVICE')
    expect(alertCategory('DEVICE_SIGNAL_LOST')).toBe('DEVICE')
  })
})

describe('AlertQueueService.list', () => {
  it('sem filtro traz só o que falta resolver, da empresa do administrador, real, mais novo primeiro', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findMany.mockResolvedValue([row()])
    const page = await service(prisma).list(ADMIN, {})

    const args = prisma.operationalAlert.findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      origin: { in: ['REAL'] },
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      worker: { companyId: 'company-1' },
    })
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]).toEqual({
      id: 'alert-1',
      origin: 'REAL',
      status: 'OPEN',
      createdAt: OPENED.toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      resolutionNote: null,
      triagedBy: null,
      worker: { id: 'worker-1', name: 'Ana', sector: 'Leste' },
      condition: {
        kind: 'HEART_RATE_HIGH',
        category: 'URGENT',
        observedValue: 185,
        thresholdValue: 165,
        openedAt: OPENED.toISOString(),
        recoveredAt: null,
      },
    })
  })

  it('filtra pelos estados pedidos', async () => {
    const prisma = prismaDouble()
    await service(prisma).list(ADMIN, { status: ['RESOLVED'] })
    expect(prisma.operationalAlert.findMany.mock.calls[0][0].where.status).toEqual({ in: ['RESOLVED'] })
  })

  it('pagina pelo cursor: pede um a mais e devolve o id do último como próximo cursor', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findMany.mockResolvedValue([row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })])
    const page = await service(prisma).list(ADMIN, { limit: 2, cursor: 'z' })

    const args = prisma.operationalAlert.findMany.mock.calls[0][0]
    expect(args.take).toBe(3)
    expect(args.cursor).toEqual({ id: 'z' })
    expect(args.skip).toBe(1)
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(page.nextCursor).toBe('b')
  })

  it('administrador sem empresa não tem fila', async () => {
    await expect(service(prismaDouble()).list({ ...ADMIN, companyId: null }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })
})

// Homologação liga a flag para o roteiro de aceite ver na fila o alerta que o
// injetor de demonstração abre. Produção nunca liga.
describe('AlertQueueService com TELEMETRY_ALERTS_INCLUDE_DEMO', () => {
  const original = process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
  afterEach(() => {
    if (original === undefined) delete process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
    else process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = original
  })

  it('desligada: a fila e a triagem só enxergam origem real', async () => {
    delete process.env.TELEMETRY_ALERTS_INCLUDE_DEMO
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(null)
    await service(prisma).list(ADMIN, {})
    expect(prisma.operationalAlert.findMany.mock.calls[0][0].where.origin).toEqual({ in: ['REAL'] })
    await expect(service(prisma).acknowledge(ADMIN, 'demo-1', NOW)).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.operationalAlert.findFirst.mock.calls[0][0].where.origin).toEqual({ in: ['REAL'] })
  })

  it('ligada: a fila traz demonstração com a origem marcada', async () => {
    process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = '1'
    const prisma = prismaDouble()
    prisma.operationalAlert.findMany.mockResolvedValue([row({ id: 'demo-1', origin: 'DEMO' })])
    const page = await service(prisma).list(ADMIN, {})
    expect(prisma.operationalAlert.findMany.mock.calls[0][0].where.origin).toEqual({ in: ['REAL', 'DEMO'] })
    expect(page.items[0].origin).toBe('DEMO')
  })

  it('ligada: alerta de demonstração pode ser triado', async () => {
    process.env.TELEMETRY_ALERTS_INCLUDE_DEMO = '1'
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst
      .mockResolvedValueOnce(row({ id: 'demo-1', origin: 'DEMO' }))
      .mockResolvedValueOnce(row({ id: 'demo-1', origin: 'DEMO', status: 'ACKNOWLEDGED', acknowledgedAt: NOW }))
    const item = await service(prisma).acknowledge(ADMIN, 'demo-1', NOW)
    expect(prisma.operationalAlert.findFirst.mock.calls[0][0].where.origin).toEqual({ in: ['REAL', 'DEMO'] })
    expect(item).toMatchObject({ origin: 'DEMO', status: 'ACKNOWLEDGED' })
  })
})

describe('AlertQueueService.acknowledge', () => {
  it('alerta aberto passa a reconhecido, com o horário e quem reconheceu', async () => {
    const prisma = prismaDouble()
    const acked = row({
      status: 'ACKNOWLEDGED',
      acknowledgedAt: NOW,
      triagedBy: { id: 'admin-1', name: 'Bia' },
    })
    prisma.operationalAlert.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(acked)

    const item = await service(prisma).acknowledge(ADMIN, 'alert-1', NOW)

    expect(prisma.operationalAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'alert-1', status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: NOW, triagedById: 'admin-1' },
    })
    expect(item.status).toBe('ACKNOWLEDGED')
    expect(item.triagedBy).toEqual({ id: 'admin-1', name: 'Bia' })
  })

  it('procura o alerta só dentro da empresa e da origem real', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(row({ status: 'ACKNOWLEDGED' }))
    await service(prisma).acknowledge(ADMIN, 'alert-1', NOW)
    expect(prisma.operationalAlert.findFirst.mock.calls[0][0].where).toEqual({
      id: 'alert-1',
      origin: { in: ['REAL'] },
      worker: { companyId: 'company-1' },
    })
  })

  it('repetir não muda nada: já reconhecido volta como está', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(row({ status: 'ACKNOWLEDGED', acknowledgedAt: OPENED }))
    const item = await service(prisma).acknowledge(ADMIN, 'alert-1', NOW)
    expect(prisma.operationalAlert.updateMany).not.toHaveBeenCalled()
    expect(item.acknowledgedAt).toBe(OPENED.toISOString())
  })

  it('reconhecer o que já foi resolvido é conflito', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(row({ status: 'RESOLVED' }))
    await expect(service(prisma).acknowledge(ADMIN, 'alert-1', NOW)).rejects.toBeInstanceOf(ConflictException)
  })

  it('alerta de outra empresa, de demonstração ou inexistente responde igual: não encontrado', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(null)
    await expect(service(prisma).acknowledge(ADMIN, 'alert-x', NOW)).rejects.toBeInstanceOf(NotFoundException)
  })

  // Dois administradores clicando juntos: a transição é condicional ao estado,
  // e quem perde a corrida recebe o estado que ganhou, não um erro.
  it('perdeu a corrida para outro reconhecimento: devolve o estado atual', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.updateMany.mockResolvedValue({ count: 0 })
    prisma.operationalAlert.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'ACKNOWLEDGED', acknowledgedAt: NOW }))
    const item = await service(prisma).acknowledge(ADMIN, 'alert-1', NOW)
    expect(item.status).toBe('ACKNOWLEDGED')
  })

  it('perdeu a corrida para uma resolução: conflito', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.updateMany.mockResolvedValue({ count: 0 })
    prisma.operationalAlert.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'RESOLVED', resolvedAt: NOW }))
    await expect(service(prisma).acknowledge(ADMIN, 'alert-1', NOW)).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('AlertQueueService.resolve', () => {
  it('resolve a partir de aberto, com horário, quem resolveu e a nota', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'RESOLVED', resolvedAt: NOW, resolutionNote: 'Pausa feita' }))

    const item = await service(prisma).resolve(ADMIN, 'alert-1', 'Pausa feita', NOW)

    expect(prisma.operationalAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'alert-1', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: NOW, triagedById: 'admin-1', resolutionNote: 'Pausa feita' },
    })
    expect(item.status).toBe('RESOLVED')
    expect(item.resolutionNote).toBe('Pausa feita')
  })

  it('resolve a partir de reconhecido, sem nota', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst
      .mockResolvedValueOnce(row({ status: 'ACKNOWLEDGED' }))
      .mockResolvedValueOnce(row({ status: 'RESOLVED', resolvedAt: NOW }))
    await service(prisma).resolve(ADMIN, 'alert-1', undefined, NOW)
    expect(prisma.operationalAlert.updateMany.mock.calls[0][0].data.resolutionNote).toBeNull()
  })

  it('repetir não muda nada: já resolvido volta como está, nota original preservada', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(
      row({ status: 'RESOLVED', resolvedAt: OPENED, resolutionNote: 'primeira' }),
    )
    const item = await service(prisma).resolve(ADMIN, 'alert-1', 'segunda', NOW)
    expect(prisma.operationalAlert.updateMany).not.toHaveBeenCalled()
    expect(item.resolutionNote).toBe('primeira')
  })

  it('alerta dispensado não se resolve: conflito', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(row({ status: 'DISMISSED' }))
    await expect(service(prisma).resolve(ADMIN, 'alert-1', undefined, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('fora do escopo: não encontrado', async () => {
    const prisma = prismaDouble()
    prisma.operationalAlert.findFirst.mockResolvedValue(null)
    await expect(service(prisma).resolve(ADMIN, 'alert-x', undefined, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
