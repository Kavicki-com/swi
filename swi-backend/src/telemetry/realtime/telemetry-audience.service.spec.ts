import { Logger } from '@nestjs/common'
import type { PrismaService } from '../../prisma/prisma.service'
import { AUDIENCE_CACHE_TTL_MS, TelemetryAudienceService } from './telemetry-audience.service'

// Quem recebe o aviso de telemetria de um funcionário: ele mesmo e os
// administradores ativos da empresa dele. O Prisma é dublê; o que estes casos
// protegem é o recorte por empresa, o cache curto e o recuo seguro quando a
// busca falha.

const prismaDouble = (companyId: string | null = 'company-1', admins: string[] = ['admin-1', 'admin-2']) => ({
  user: {
    findUnique: jest.fn().mockResolvedValue({ companyId }),
    findMany: jest.fn().mockResolvedValue(admins.map((id) => ({ id }))),
  },
})

const audience = (prisma: ReturnType<typeof prismaDouble>) =>
  new TelemetryAudienceService(prisma as unknown as PrismaService)

describe('TelemetryAudienceService.recipientsFor', () => {
  afterEach(() => jest.restoreAllMocks())

  it('entrega ao funcionário e aos administradores ativos da empresa dele', async () => {
    const prisma = prismaDouble()

    await expect(audience(prisma).recipientsFor('worker-1')).resolves.toEqual(['worker-1', 'admin-1', 'admin-2'])
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', companyId: 'company-1', active: true },
      select: { id: true },
    })
  })

  // A mesma regra do read model: administrador sem empresa não lê telemetria
  // de ninguém, então também não recebe aviso.
  it('funcionário sem empresa avisa só a ele mesmo', async () => {
    const prisma = prismaDouble(null)

    await expect(audience(prisma).recipientsFor('worker-1')).resolves.toEqual(['worker-1'])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('repete a resposta dentro do prazo do cache sem voltar ao banco', async () => {
    const prisma = prismaDouble()
    const service = audience(prisma)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)

    await service.recipientsFor('worker-1')
    now.mockReturnValue(1_000_000 + AUDIENCE_CACHE_TTL_MS - 1)
    await service.recipientsFor('worker-1')

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
  })

  it('passado o prazo do cache, busca de novo e enxerga quem mudou', async () => {
    const prisma = prismaDouble()
    const service = audience(prisma)
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
    await service.recipientsFor('worker-1')

    prisma.user.findMany.mockResolvedValue([{ id: 'admin-3' }])
    now.mockReturnValue(1_000_000 + AUDIENCE_CACHE_TTL_MS + 1)

    await expect(service.recipientsFor('worker-1')).resolves.toEqual(['worker-1', 'admin-3'])
  })

  it('o cache dos administradores é por empresa: outro funcionário da mesma empresa reaproveita', async () => {
    const prisma = prismaDouble()
    const service = audience(prisma)

    await service.recipientsFor('worker-1')
    await service.recipientsFor('worker-2')

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2)
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
  })

  // O aviso é posterior à escrita: uma falha aqui não pode derrubar quem já
  // gravou, e o funcionário continua recebendo o próprio aviso.
  it('falha na busca recua para só o funcionário, sem levantar', async () => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockRejectedValue(new Error('banco fora'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(audience(prisma).recipientsFor('worker-1')).resolves.toEqual(['worker-1'])
  })

  it('funcionário que também é administrador não recebe o aviso duas vezes', async () => {
    const prisma = prismaDouble('company-1', ['worker-1', 'admin-1'])

    await expect(audience(prisma).recipientsFor('worker-1')).resolves.toEqual(['worker-1', 'admin-1'])
  })
})
